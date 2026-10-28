// Histórico de jogos do Nante, guardado na tabela "jogos" do Neon (Postgres).
// Os jogos ficam em memória e são gravados na base de dados em lotes.

require('dotenv').config();
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
if (pool) pool.on('error', e => console.error('Neon:', e.message));  // evita crash se o Neon fechar uma ligação parada

const ATRASO_SALVAR_MS = 5000;     // junta várias alterações numa só gravação
const ATRASO_REPETIR_MS = 30000;   // se falhar, tenta de novo passado este tempo
const usaGitHub = !!pool;          // nome antigo mantido, para o server.js não mudar

let dados = { jogos: [] };
const sujosIds = new Set();        // ids dos jogos com alterações por gravar      // há alterações por gravar?
let aSalvar = false;
let timer = null;
let proximoId = 1;
let ativo = false;       // só fica true depois de carregar o histórico com sucesso (protege contra sobrescrever dados)


// ===== Carregar / guardar =====
async function carregar() {
  if (!pool) {
    dados = { jogos: [] };
    console.log('Histórico: sem DATABASE_URL, só em memória.');
  } else {
    const r = await pool.query(
      'SELECT id, criado_em, fim, sala_id, n_jogadores, n_pecas, participantes, estado FROM jogos ORDER BY id'
    );
    dados.jogos = r.rows.map(x => ({
      id: x.id,
      inicio: x.criado_em.toISOString(),
      fim: x.fim ? x.fim.toISOString() : null,
      salaId: x.sala_id,
      totalPlayers: x.n_jogadores,
      totalPecas: x.n_pecas,
      jogadores: x.participantes,
      estado: x.estado
    }));
    console.log('Histórico: Neon (' + dados.jogos.length + ' jogos).');
  }
  // jogos que ficaram "em curso" quando o servidor parou foram interrompidos
  dados.jogos.forEach(j => {
    if (j.estado === 'em curso') { j.estado = 'interrompido'; sujosIds.add(j.id); }
  });
  proximoId = dados.jogos.reduce((m, j) => Math.max(m, j.id), 0) + 1;
  ativo = true;
  if (sujosIds.size) agendar(ATRASO_SALVAR_MS);
}

function agendar(ms) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; salvarAgora(); }, ms);
}

function marcarSujo(id) {
  sujosIds.add(id);
  agendar(ATRASO_SALVAR_MS);
}
async function salvarAgora() {
  if (aSalvar || !pool) return;
  aSalvar = true;
  const ids = [...sujosIds];
  sujosIds.clear();
  try {
    for (const id of ids) {
      const j = dados.jogos.find(x => x.id === id);
      if (!j) continue;
      try {
        await pool.query(
          `INSERT INTO jogos (id, criado_em, fim, sala_id, n_jogadores, n_pecas, participantes, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE
           SET fim = EXCLUDED.fim, participantes = EXCLUDED.participantes, estado = EXCLUDED.estado`,
          [j.id, j.inicio, j.fim, j.salaId, j.totalPlayers, j.totalPecas, JSON.stringify(j.jogadores), j.estado]
        );
      } catch (e) {
        console.error('Histórico: erro ao gravar o jogo ' + id + ':', e.message);
        sujosIds.add(id);   // tenta de novo mais tarde
      }
    }
  } finally {
    aSalvar = false;
    if (sujosIds.size) agendar(ATRASO_REPETIR_MS);
  }
}
// Chamar quando o servidor vai desligar (o Render envia SIGTERM em cada deploy)
async function salvarAntesDeSair() {
  if (!ativo) return;
  if (timer) { clearTimeout(timer); timer = null; }
  await salvarAgora();
}

// ===== Registo de jogos =====
function registarInicio(sala) {
  if (!ativo) return null;
  const id = proximoId++;
  dados.jogos.push({
    id,
    inicio: new Date().toISOString(),
    fim: null,
    salaId: sala.id,
    totalPlayers: sala.totalPlayers,
    totalPecas: sala.totalPecas,
    jogadores: sala.jogadores.map(j => ({ nome: j.nome, indice: j.indice, classificacao: null, abandonou: false })),
    estado: 'em curso'
  });
  marcarSujo(id);
  return id;
}

// estadoJogo = sala.estadoDoJogo (tem .jogadores[indice].classificacao / .abandonou)
// estadoFinal: 'terminado' (normal) ou 'abandonado' (todos saíram a meio)
function registarFim(id, estadoJogo, estadoFinal) {
  if (!ativo || id == null) return;
  const jogo = dados.jogos.find(j => j.id === id);
  if (!jogo || jogo.estado !== 'em curso') return;   // já fechado: não regista duas vezes
  jogo.jogadores.forEach(j => {
    const p = estadoJogo.jogadores[j.indice];
    if (p) { j.classificacao = p.classificacao; j.abandonou = p.abandonou; }
  });
  jogo.fim = new Date().toISOString();
  jogo.estado = estadoFinal || 'terminado';
  marcarSujo(id);
}

// ===== Consulta (para a página de admin) =====
const diaLocal = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });  // AAAA-MM-DD

function resumo() {
  const porDia = {};
  dados.jogos.forEach(j => { const d = diaLocal(j.inicio); porDia[d] = (porDia[d] || 0) + 1; });
  return {
    total: dados.jogos.length,
    dias: Object.keys(porDia).sort().reverse().map(d => ({ dia: d, jogos: porDia[d] })),
    jogos: [...dados.jogos].reverse()   // mais recentes primeiro
  };
}

module.exports = { carregar, registarInicio, registarFim, resumo, salvarAntesDeSair, usaGitHub };

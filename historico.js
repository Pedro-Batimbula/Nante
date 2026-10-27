// Histórico de jogos do Nante.
// Guarda um JSON (historico.json) num ramo separado do GitHub ("dados"), para que
// o Render NÃO faça deploy a cada gravação e os dados sobrevivam a reinícios.
// Sem GITHUB_TOKEN (ex.: no teu PC), guarda num ficheiro local: historico.local.json.

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || 'Pedro-Batimbula/Nante';
const RAMO = process.env.GITHUB_BRANCH || 'dados';
const RAMO_BASE = process.env.GITHUB_BASE_BRANCH || 'main';
const FICHEIRO = 'historico.json';
const LOCAL = path.join(__dirname, 'historico.local.json');
const ATRASO_SALVAR_MS = 5000;     // junta várias alterações numa só gravação
const ATRASO_REPETIR_MS = 30000;   // se falhar, tenta de novo passado este tempo
const usaGitHub = !!TOKEN;

let dados = { jogos: [] };
let sha = null;          // versão atual do ficheiro no GitHub
let sujo = false;        // há alterações por gravar?
let aSalvar = false;
let timer = null;
let proximoId = 1;

// ===== GitHub =====
async function gh(metodo, rota, corpo) {
  const res = await fetch('https://api.github.com/repos/' + REPO + rota, {
    method: metodo,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nante-server',
      'Content-Type': 'application/json'
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* resposta sem JSON */ }
  return { status: res.status, json };
}

// Cria o ramo "dados" (a partir do main) se ainda não existir
async function garantirRamo() {
  const r = await gh('GET', '/git/ref/heads/' + RAMO);
  if (r.status === 200) return;
  if (r.status !== 404) throw new Error('GitHub: erro ao verificar o ramo (' + r.status + ')');
  const base = await gh('GET', '/git/ref/heads/' + RAMO_BASE);
  if (base.status !== 200) throw new Error('GitHub: não encontrei o ramo ' + RAMO_BASE + ' (' + base.status + ')');
  const c = await gh('POST', '/git/refs', { ref: 'refs/heads/' + RAMO, sha: base.json.object.sha });
  if (c.status !== 201) throw new Error('GitHub: não consegui criar o ramo ' + RAMO + ' (' + c.status + ')');
  console.log('Ramo "' + RAMO + '" criado no GitHub.');
}

// ===== Carregar / guardar =====
async function carregar() {
  if (!usaGitHub) {
    try { dados = JSON.parse(fs.readFileSync(LOCAL, 'utf8')); } catch (e) { dados = { jogos: [] }; }
    console.log('Histórico: modo LOCAL (' + dados.jogos.length + ' jogos). Sem GITHUB_TOKEN.');
  } else {
    await garantirRamo();
    const r = await gh('GET', '/contents/' + FICHEIRO + '?ref=' + RAMO);
    if (r.status === 200) {
      sha = r.json.sha;
      dados = JSON.parse(Buffer.from(r.json.content, 'base64').toString('utf8'));
    } else if (r.status === 404) {
      sha = null;
      dados = { jogos: [] };
    } else {
      throw new Error('GitHub: erro ao ler o histórico (' + r.status + ')');
    }
    console.log('Histórico: GitHub (' + dados.jogos.length + ' jogos).');
  }
  // jogos que ficaram "em curso" quando o servidor parou foram interrompidos
  dados.jogos.forEach(j => { if (j.estado === 'em curso') j.estado = 'interrompido'; });
  proximoId = dados.jogos.reduce((m, j) => Math.max(m, j.id), 0) + 1;
}

function agendar(ms) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; salvarAgora(); }, ms);
}

function marcarSujo() {
  sujo = true;
  agendar(ATRASO_SALVAR_MS);
}

async function salvarAgora() {
  if (aSalvar) return;
  aSalvar = true;
  let tentativas = 0;
  try {
    while (sujo && tentativas < 3) {
      sujo = false;
      tentativas++;
      const conteudo = JSON.stringify(dados, null, 1);

      if (!usaGitHub) { fs.writeFileSync(LOCAL, conteudo); continue; }

      const corpo = {
        message: 'historico: ' + dados.jogos.length + ' jogos',
        content: Buffer.from(conteudo, 'utf8').toString('base64'),
        branch: RAMO
      };
      if (sha) corpo.sha = sha;
      const r = await gh('PUT', '/contents/' + FICHEIRO, corpo);

      if (r.status === 200 || r.status === 201) {
        sha = r.json.content.sha;
      } else if (r.status === 409 || r.status === 422) {
        // versão desatualizada: vai buscar a atual e tenta outra vez
        const atual = await gh('GET', '/contents/' + FICHEIRO + '?ref=' + RAMO);
        sha = atual.status === 200 ? atual.json.sha : null;
        sujo = true;
      } else {
        console.error('Histórico: falha ao gravar no GitHub (' + r.status + ')');
        sujo = true;
        break;
      }
    }
  } catch (e) {
    console.error('Histórico: erro ao gravar:', e.message);
    sujo = true;
  } finally {
    aSalvar = false;
    if (sujo) agendar(ATRASO_REPETIR_MS);
  }
}

// Chamar quando o servidor vai desligar (o Render envia SIGTERM em cada deploy)
async function salvarAntesDeSair() {
  if (timer) { clearTimeout(timer); timer = null; }
  await salvarAgora();
}

// ===== Registo de jogos =====
function registarInicio(sala) {
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
  marcarSujo();
  return id;
}

// estadoJogo = sala.estadoDoJogo (tem .jogadores[indice].classificacao / .abandonou)
function registarFim(id, estadoJogo) {
  const jogo = dados.jogos.find(j => j.id === id);
  if (!jogo) return;
  jogo.jogadores.forEach(j => {
    const p = estadoJogo.jogadores[j.indice];
    if (p) { j.classificacao = p.classificacao; j.abandonou = p.abandonou; }
  });
  jogo.fim = new Date().toISOString();
  jogo.estado = 'terminado';
  marcarSujo();
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

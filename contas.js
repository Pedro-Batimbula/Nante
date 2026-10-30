// Contas do Nante: jogadores guardados na tabela "jogadores" do Neon.
// A sessão é um código secreto guardado no aparelho; aqui só fica o hash dele.

require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
if (pool) pool.on('error', e => console.error('Neon (contas):', e.message));

const memoria = [];      // usado só sem DATABASE_URL (testes locais)
let pronto = false;

const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const limparNome = n => String(n || '').trim().replace(/\s+/g, ' ');

async function iniciar() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nante_contas (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        nome_minusculas TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query('ALTER TABLE nante_contas ADD COLUMN IF NOT EXISTS senha_hash TEXT');
    // Moedas (todos começam com 100) e estatísticas
    await pool.query('ALTER TABLE nante_contas ADD COLUMN IF NOT EXISTS moedas INTEGER NOT NULL DEFAULT 100');
    await pool.query('ALTER TABLE nante_contas ADD COLUMN IF NOT EXISTS vitorias INTEGER NOT NULL DEFAULT 0');
    await pool.query('ALTER TABLE nante_contas ADD COLUMN IF NOT EXISTS jogos INTEGER NOT NULL DEFAULT 0');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS moedas_movimentos (
        id SERIAL PRIMARY KEY,
        jogador_id INTEGER NOT NULL REFERENCES nante_contas(id) ON DELETE CASCADE,
        valor INTEGER NOT NULL,
        motivo TEXT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`
      INSERT INTO moedas_movimentos (jogador_id, valor, motivo)
      SELECT c.id, 100, 'bonus_inicial' FROM nante_contas c
      WHERE NOT EXISTS (SELECT 1 FROM moedas_movimentos m WHERE m.jogador_id = c.id AND m.motivo = 'bonus_inicial')`);
    // Amigos: um pedido (pendente) que passa a aceite; um só registo por par de jogadores
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nante_amigos (
        id SERIAL PRIMARY KEY,
        de_id INTEGER NOT NULL REFERENCES nante_contas(id) ON DELETE CASCADE,
        para_id INTEGER NOT NULL REFERENCES nante_contas(id) ON DELETE CASCADE,
        estado TEXT NOT NULL DEFAULT 'pendente',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (de_id <> para_id)
      )`);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_amigos_par ON nante_amigos (LEAST(de_id, para_id), GREATEST(de_id, para_id))');
  }
  pronto = true;
  console.log('Contas: ' + (pool ? 'tabela "jogadores" pronta no Neon.' : 'sem DATABASE_URL, só em memória.'));
}

async function criar(nomeBruto, senha) {
  if (!pronto) return { erro: 'Contas indisponíveis de momento.' };
  const nome = limparNome(nomeBruto);
  if (nome.length < 2 || nome.length > 20) return { erro: 'O nome deve ter entre 2 e 20 letras.' };
  const minusculas = nome.toLowerCase();
  let senhaGuardada = null;
  if (senha) {
    if (String(senha).length < 6) return { erro: 'A palavra-passe deve ter pelo menos 6 caracteres.' };
    const sal = crypto.randomBytes(16).toString('hex');
    senhaGuardada = sal + ':' + await hashSenha(senha, sal);
  }
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hash(token);
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO nante_contas (nome, nome_minusculas, token_hash, senha_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [nome, minusculas, tokenHash, senhaGuardada]
      );
      await pool.query(
        "INSERT INTO moedas_movimentos (jogador_id, valor, motivo) VALUES ($1, 100, 'bonus_inicial')",
        [r.rows[0].id]
      );
      return { id: r.rows[0].id, nome, token, temSenha: !!senhaGuardada };
    }
    if (memoria.some(j => j.minusculas === minusculas)) return { erro: 'Esse nome já está em uso.' };
    const id = memoria.length + 1;
    memoria.push({ id, nome, minusculas, token_hash: tokenHash, senha_hash: senhaGuardada, moedas: 100, vitorias: 0, jogos: 0 });
    return { id, nome, token };
  } catch (e) {
    if (e.code === '23505') return { erro: 'Esse nome já está em uso.' };   // nome repetido
    console.error('Contas: erro ao criar:', e.message);
    return { erro: 'Não foi possível criar a conta. Tenta de novo.' };
  }
}

// Devolve { id, nome } se o par id + token estiver certo, senão null
async function validar(id, token) {
  const n = Number(id);
  if (!pronto || !Number.isInteger(n) || !token) return null;
  try {
    let linha;
    if (pool) {
      const r = await pool.query('SELECT id, nome, token_hash, senha_hash, moedas, vitorias, jogos FROM nante_contas WHERE id = $1', [n]);
      linha = r.rows[0];
    } else {
      linha = memoria.find(j => j.id === n);
    }
    if (!linha) return null;
    const a = Buffer.from(hash(token), 'hex');
    const b = Buffer.from(linha.token_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { id: linha.id, nome: linha.nome, temSenha: !!linha.senha_hash,
      moedas: linha.moedas, vitorias: linha.vitorias, jogos: linha.jogos };
  } catch (e) {
    console.error('Contas: erro ao validar:', e.message);
    return null;
  }
}

// ===== Palavra-passe (opcional): permite entrar noutro aparelho =====
const hashSenha = (senha, sal) => new Promise((ok, falha) =>
  crypto.scrypt(String(senha), sal, 32, (e, k) => (e ? falha(e) : ok(k.toString('hex')))));

async function definirSenha(id, token, senha) {
  const c = await validar(id, token);
  if (!c) return { erro: 'Sessão inválida.', status: 401 };
  if (String(senha || '').length < 6) return { erro: 'A palavra-passe deve ter pelo menos 6 caracteres.' };
  try {
    const sal = crypto.randomBytes(16).toString('hex');
    const guardado = sal + ':' + await hashSenha(senha, sal);
    if (pool) {
      const r = await pool.query('UPDATE nante_contas SET senha_hash = $1 WHERE id = $2 AND senha_hash IS NULL', [guardado, c.id]);
      if (r.rowCount === 0) return { erro: 'Esta conta já tem palavra-passe.' };
    } else {
      const m = memoria.find(j => j.id === c.id);
      if (m.senha_hash) return { erro: 'Esta conta já tem palavra-passe.' };
      m.senha_hash = guardado;
    }
    return { ok: true };
  } catch (e) {
    console.error('Contas: erro ao definir palavra-passe:', e.message);
    return { erro: 'Não foi possível guardar a palavra-passe.' };
  }
}

const falhas = new Map();   // nome -> { n, ate }: trava tentativas repetidas

// Nome + palavra-passe certos: devolve { id, nome, token } com um código novo para este aparelho
async function entrar(nomeBruto, senha) {
  if (!pronto) return { erro: 'Contas indisponíveis de momento.' };
  const minusculas = limparNome(nomeBruto).toLowerCase();
  const f = falhas.get(minusculas) || { n: 0, ate: 0 };
  if (f.ate > Date.now()) return { erro: 'Demasiadas tentativas. Espera um minuto.' };
  const errado = () => {
    f.n++;
    if (f.n >= 5) { f.n = 0; f.ate = Date.now() + 60000; }
    falhas.set(minusculas, f);
    return { erro: 'Nome ou palavra-passe errados.' };
  };
  try {
    let linha;
    if (pool) {
      const r = await pool.query('SELECT id, nome, senha_hash FROM nante_contas WHERE nome_minusculas = $1', [minusculas]);
      linha = r.rows[0];
    } else {
      linha = memoria.find(j => j.minusculas === minusculas);
    }
    if (!linha) return errado();
    if (!linha.senha_hash) {
      return { erro: 'Esta conta ainda não tem palavra-passe. Abre-a no aparelho onde a criaste e usa "Proteger conta".' };
    }
    const [sal, esperado] = linha.senha_hash.split(':');
    const a = Buffer.from(await hashSenha(senha, sal), 'hex');
    const b = Buffer.from(esperado, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return errado();
    falhas.delete(minusculas);
    const token = crypto.randomBytes(24).toString('hex');
    if (pool) await pool.query('UPDATE nante_contas SET token_hash = $1 WHERE id = $2', [hash(token), linha.id]);
    else linha.token_hash = hash(token);
    return { id: linha.id, nome: linha.nome, token };
  } catch (e) {
    console.error('Contas: erro ao entrar:', e.message);
    return { erro: 'Não foi possível entrar. Tenta de novo.' };
  }
}

// ===== Moedas e estatísticas (só o servidor chama isto) =====
// valor positivo = ganha, negativo = gasta. Devolve { moedas } ou { erro }.
// Num só comando: atualiza o saldo e regista o movimento (ou falha sem mexer em nada).
async function mexerMoedas(id, valor, motivo) {
  const n = Number(id), v = Math.trunc(Number(valor));
  if (!pronto || !Number.isInteger(n) || !v) return { erro: 'Pedido inválido.' };
  try {
    if (pool) {
      const r = await pool.query(
        `WITH u AS (
           UPDATE nante_contas SET moedas = moedas + $1::int
           WHERE id = $2 AND moedas + $1::int >= 0 RETURNING id, moedas
         ), m AS (
           INSERT INTO moedas_movimentos (jogador_id, valor, motivo)
           SELECT id, $1::int, $3 FROM u
         )
         SELECT moedas FROM u`,
        [v, n, String(motivo || 'outro')]
      );
      if (!r.rowCount) return { erro: 'Moedas insuficientes.' };
      return { moedas: r.rows[0].moedas };
    }
    const m = memoria.find(j => j.id === n);
    if (!m || m.moedas + v < 0) return { erro: 'Moedas insuficientes.' };
    m.moedas += v;
    return { moedas: m.moedas };
  } catch (e) {
    console.error('Contas: erro nas moedas:', e.message);
    return { erro: 'Não foi possível atualizar as moedas.' };
  }
}

// Fim de jogo: soma 1 jogo e, se venceu, 1 vitória
async function registarResultado(id, venceu) {
  const n = Number(id);
  if (!pronto || !Number.isInteger(n)) return;
  try {
    if (pool) {
      await pool.query(
        'UPDATE nante_contas SET jogos = jogos + 1, vitorias = vitorias + $2 WHERE id = $1',
        [n, venceu ? 1 : 0]
      );
    } else {
      const m = memoria.find(j => j.id === n);
      if (m) { m.jogos++; if (venceu) m.vitorias++; }
    }
  } catch (e) {
    console.error('Contas: erro ao registar resultado:', e.message);
  }
}

// ===== Diagnóstico da ligação à base de dados (temporário) =====
async function diagnostico() {
  const r = { temDatabaseUrl: !!process.env.DATABASE_URL, modo: pool ? 'neon' : 'memoria', pronto };
  if (process.env.DATABASE_URL) {
    try { r.host = new URL(process.env.DATABASE_URL).hostname; }
    catch (e) { r.urlInvalida = true; }
  }
  if (pool) {
    try {
      const q = await pool.query('SELECT current_database() AS bd, (SELECT COUNT(*)::int FROM nante_contas) AS contas');
      r.baseDeDados = q.rows[0].bd;
      r.totalContas = q.rows[0].contas;
    } catch (e) { r.erroConsulta = e.message; }
  }
  return r;
}

// ===== Amigos (só com base de dados) =====
const SEM_BD = { erro: 'Os amigos precisam da base de dados.' };
const PREMIO_CONVITE = 50, MAX_CONVITES_PAGOS = 20;

// Envia um pedido pelo nome. Se o outro já tinha enviado um pedido, ficam logo amigos.
async function pedirAmizade(deId, nomeBruto) {
  if (!pool) return SEM_BD;
  const nome = limparNome(nomeBruto).toLowerCase();
  if (nome.length < 2) return { erro: 'Escreve o nome do jogador.' };
  try {
    const a = await pool.query('SELECT id, nome FROM nante_contas WHERE nome_minusculas = $1', [nome]);
    const alvo = a.rows[0];
    if (!alvo) return { erro: 'Não existe nenhum jogador com esse nome.' };
    if (alvo.id === deId) return { erro: 'Não podes adicionar-te a ti próprio.' };
    const e = await pool.query(
      'SELECT id, de_id, estado FROM nante_amigos WHERE LEAST(de_id, para_id) = LEAST($1::int, $2::int) AND GREATEST(de_id, para_id) = GREATEST($1::int, $2::int)',
      [deId, alvo.id]
    );
    const ex = e.rows[0];
    if (ex) {
      if (ex.estado === 'aceite') return { erro: alvo.nome + ' já é teu amigo.' };
      if (ex.de_id === deId) return { erro: 'Já enviaste um pedido a ' + alvo.nome + '.' };
      await pool.query("UPDATE nante_amigos SET estado = 'aceite' WHERE id = $1", [ex.id]);
      return { ok: true, aceite: true, alvo };
    }
    await pool.query('INSERT INTO nante_amigos (de_id, para_id) VALUES ($1, $2)', [deId, alvo.id]);
    return { ok: true, aceite: false, alvo };
  } catch (e) {
    if (e.code === '23505') return { erro: 'Já existe um pedido entre vocês.' };
    console.error('Contas: erro ao pedir amizade:', e.message);
    return { erro: 'Não foi possível enviar o pedido.' };
  }
}

// Aceitar ou recusar um pedido que recebi
async function responderPedido(meuId, pedidoId, aceitar) {
  if (!pool) return SEM_BD;
  const n = Number(pedidoId);
  if (!Number.isInteger(n)) return { erro: 'Pedido inválido.' };
  try {
    if (aceitar) {
      const r = await pool.query(
        `UPDATE nante_amigos AS a SET estado = 'aceite'
         FROM nante_contas c
         WHERE a.id = $1 AND a.para_id = $2 AND a.estado = 'pendente' AND c.id = a.de_id
         RETURNING c.id AS outro_id, c.nome AS outro_nome`,
        [n, meuId]
      );
      if (!r.rowCount) return { erro: 'Esse pedido já não existe.' };
      return { ok: true, aceite: true, outro: { id: r.rows[0].outro_id, nome: r.rows[0].outro_nome } };
    }
    const r = await pool.query(
      "DELETE FROM nante_amigos WHERE id = $1 AND para_id = $2 AND estado = 'pendente' RETURNING de_id",
      [n, meuId]
    );
    if (!r.rowCount) return { erro: 'Esse pedido já não existe.' };
    return { ok: true, aceite: false, outro: { id: r.rows[0].de_id } };
  } catch (e) {
    console.error('Contas: erro ao responder pedido:', e.message);
    return { erro: 'Não foi possível responder ao pedido.' };
  }
}

// Remover um amigo ou cancelar um pedido que enviei (serve para os dois)
async function removerAmizade(meuId, outroId) {
  if (!pool) return SEM_BD;
  const o = Number(outroId);
  if (!Number.isInteger(o)) return { erro: 'Pedido inválido.' };
  try {
    const r = await pool.query(
      'DELETE FROM nante_amigos WHERE (de_id = $1 AND para_id = $2) OR (de_id = $2 AND para_id = $1)',
      [meuId, o]
    );
    return { ok: true, removido: r.rowCount > 0 };
  } catch (e) {
    console.error('Contas: erro ao remover amigo:', e.message);
    return { erro: 'Não foi possível remover.' };
  }
}

// Amigos, pedidos recebidos e pedidos enviados
async function listarAmigos(meuId) {
  const vazio = { amigos: [], recebidos: [], enviados: [] };
  if (!pool) return vazio;
  try {
    const r = await pool.query(
      `SELECT a.id AS pedido_id, a.para_id, a.estado, c.id AS outro_id, c.nome, c.vitorias, c.moedas
       FROM nante_amigos a
       JOIN nante_contas c ON c.id = CASE WHEN a.de_id = $1 THEN a.para_id ELSE a.de_id END
       WHERE a.de_id = $1 OR a.para_id = $1
       ORDER BY c.nome_minusculas`,
      [meuId]
    );
    const res = { amigos: [], recebidos: [], enviados: [] };
    r.rows.forEach(l => {
      const o = { id: l.outro_id, nome: l.nome };
      if (l.estado === 'aceite') res.amigos.push({ ...o, vitorias: l.vitorias, moedas: l.moedas });
      else if (l.para_id === meuId) res.recebidos.push({ ...o, pedidoId: l.pedido_id });
      else res.enviados.push({ ...o, pedidoId: l.pedido_id });
    });
    return res;
  } catch (e) {
    console.error('Contas: erro ao listar amigos:', e.message);
    return vazio;
  }
}

// Procura jogadores pelo nome (basta uma parte). Diz se já são amigos ou se há pedido pendente.
async function procurarJogadores(meuId, termoBruto) {
  if (!pool) return SEM_BD;
  const t = limparNome(termoBruto).toLowerCase();
  if (t.length < 2) return { lista: [] };
  try {
    const padrao = '%' + t.replace(/[\\%_]/g, c => '\\' + c) + '%';
    const r = await pool.query(
      `SELECT c.id, c.nome, c.vitorias, a.estado AS rel
       FROM nante_contas c
       LEFT JOIN nante_amigos a
         ON LEAST(a.de_id, a.para_id) = LEAST($1::int, c.id)
        AND GREATEST(a.de_id, a.para_id) = GREATEST($1::int, c.id)
       WHERE c.id <> $1::int AND c.nome_minusculas LIKE $2
       ORDER BY (c.nome_minusculas = $3) DESC, c.nome_minusculas
       LIMIT 8`,
      [meuId, padrao, t]
    );
    return { lista: r.rows.map(l => ({ id: l.id, nome: l.nome, vitorias: l.vitorias, rel: l.rel || null })) };
  } catch (e) {
    console.error('Contas: erro ao procurar jogadores:', e.message);
    return { erro: 'Erro na pesquisa: ' + e.message };   // temporário, para diagnóstico
  }
}

// Só os ids dos amigos aceites (para a presença: quem está online)
async function idsDosAmigos(meuId) {
  if (!pool) return [];
  try {
    const r = await pool.query(
      "SELECT CASE WHEN de_id = $1 THEN para_id ELSE de_id END AS id FROM nante_amigos WHERE estado = 'aceite' AND (de_id = $1 OR para_id = $1)",
      [meuId]
    );
    return r.rows.map(l => l.id);
  } catch (e) {
    return [];
  }
}

// Conta nova criada pelo link de convite de um jogador: ficam amigos e ele ganha moedas
// (no máximo MAX_CONVITES_PAGOS convites pagos por jogador)
async function amizadePorLink(novoId, anfitriaoId) {
  const h = Number(anfitriaoId);
  if (!pool || !Number.isInteger(h) || h === novoId) return null;
  try {
    const a = await pool.query('SELECT id, nome FROM nante_contas WHERE id = $1', [h]);
    if (!a.rows[0]) return null;
    await pool.query("INSERT INTO nante_amigos (de_id, para_id, estado) VALUES ($1, $2, 'aceite') ON CONFLICT DO NOTHING", [h, novoId]);
    const c = await pool.query("SELECT COUNT(*)::int AS n FROM moedas_movimentos WHERE jogador_id = $1 AND motivo = 'convite_amigo'", [h]);
    let moedas;
    if (c.rows[0].n < MAX_CONVITES_PAGOS) {
      const r = await mexerMoedas(h, PREMIO_CONVITE, 'convite_amigo');
      moedas = r.moedas;
    }
    return { anfitriao: a.rows[0], premio: moedas !== undefined ? PREMIO_CONVITE : 0, moedas };
  } catch (e) {
    console.error('Contas: erro no convite por link:', e.message);
    return null;
  }
}

module.exports = {
  diagnostico,
  iniciar, criar, validar, definirSenha, entrar, mexerMoedas, registarResultado,
  pedirAmizade, responderPedido, removerAmizade, listarAmigos, idsDosAmigos, amizadePorLink, procurarJogadores
};

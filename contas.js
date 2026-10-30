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
  }
  pronto = true;
  console.log('Contas: ' + (pool ? 'tabela "jogadores" pronta no Neon.' : 'sem DATABASE_URL, só em memória.'));
}

async function criar(nomeBruto) {
  if (!pronto) return { erro: 'Contas indisponíveis de momento.' };
  const nome = limparNome(nomeBruto);
  if (nome.length < 2 || nome.length > 20) return { erro: 'O nome deve ter entre 2 e 20 letras.' };
  const minusculas = nome.toLowerCase();
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hash(token);
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO nante_contas (nome, nome_minusculas, token_hash) VALUES ($1, $2, $3) RETURNING id',
        [nome, minusculas, tokenHash]
      );
      await pool.query(
        "INSERT INTO moedas_movimentos (jogador_id, valor, motivo) VALUES ($1, 100, 'bonus_inicial')",
        [r.rows[0].id]
      );
      return { id: r.rows[0].id, nome, token };
    }
    if (memoria.some(j => j.minusculas === minusculas)) return { erro: 'Esse nome já está em uso.' };
    const id = memoria.length + 1;
    memoria.push({ id, nome, minusculas, token_hash: tokenHash, moedas: 100, vitorias: 0, jogos: 0 });
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
    if (!linha || !linha.senha_hash) return errado();
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

module.exports = { iniciar, criar, validar, definirSenha, entrar, mexerMoedas, registarResultado };
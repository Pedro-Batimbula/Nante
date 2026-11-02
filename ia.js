// ===== Cérebro da IA do Nante =====
// Só decide; não mexe no servidor. escolherJogada(estado, nivel) devolve { pecaId, destinoId } ou null.
// Níveis: 'iniciante' | 'medio' | 'avancado'
const {
  percursoPorJogador, jogadorAtivoIndice, moverPeca,
  pecasEmJogo, pecasNoNinho, ehCasaSegura, ehCasaMultipla
} = require('./regras');

const clonar = e => JSON.parse(JSON.stringify(e));

// Probabilidade de, com 2 dados, conseguir andar exatamente d casas (1 dado ou a soma)
const PROB = (() => {
  const p = Array(13).fill(0);
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) new Set([a, b, a + b]).forEach(d => p[d]++);
  return p.map(x => x / 36);
})();

// Todas as jogadas que o motor aceita de facto (testadas numa cópia do estado)
function jogadasValidas(estado) {
  const lista = [];
  for (const [pecaId, mapa] of Object.entries(estado.destinosPorPeca || {})) {
    for (const [destinoId, op] of Object.entries(mapa)) {
      const sim = clonar(estado);
      if (moverPeca(sim, pecaId, destinoId).sucesso) {
        lista.push({ pecaId, destinoId, indiceDestino: op.indiceDestino, sim });
      }
    }
  }
  return lista;
}

// Que peças adversárias a jogada mandou para o ninho? { n, valor (progresso que perderam) }
function matadasDaJogada(antes, depois, eu) {
  let n = 0, valor = 0;
  for (const id of Object.keys(antes.pecaIndiceNoPercurso)) {
    if (Number(id.split('-')[0].slice(1)) - 1 === eu) continue;
    const a = antes.pecaIndiceNoPercurso[id], d = depois.pecaIndiceNoPercurso[id];
    if (a >= 0 && !antes.pecasTerminadas[id] && d === -1) { n++; valor += a; }
  }
  return { n, valor };
}

// Chance de uma peça minha, parada nesta casa, ser morta na próxima jogada dos adversários
function perigoNaCasa(estado, eu, casaId) {
  if (ehCasaSegura(casaId) || ehCasaMultipla(casaId)) return 0;
  let livre = 1;
  for (const o of estado.ativos) {
    const jog = estado.jogadores[o];
    if (o === eu || jog.abandonou || jog.classificacao !== null) continue;
    const P = percursoPorJogador[o];
    for (const id of pecasEmJogo(estado, o)) {
      const i = estado.pecaIndiceNoPercurso[id];
      for (let d = 1; d <= 12; d++) {
        if (P[i + d] === casaId) { livre *= 1 - PROB[d]; break; }
      }
    }
    if (pecasNoNinho(estado, o).length) {          // entra com um 6 e anda o outro dado
      for (let d = 1; d <= 6; d++) if (P[d] === casaId) livre *= 1 - (d === 6 ? 1 / 36 : 2 / 36);
      if (P[0] === casaId) livre *= 0.9;           // esmagar na entrada
    }
  }
  return 1 - livre;
}

// Quanto "valor" minhas peças em jogo arriscam perder (perigo x progresso já feito)
function exposicao(estado, eu) {
  let total = 0;
  for (const id of pecasEmJogo(estado, eu)) {
    const i = estado.pecaIndiceNoPercurso[id];
    total += perigoNaCasa(estado, eu, estado.pecaLocalizacao[id]) * (15 + i);
  }
  return total;
}

function terminouPeca(antes, depois, eu) {
  return depois.jogadores[eu].pecasTerminadas > antes.jogadores[eu].pecasTerminadas;
}

function pontuar(nivel, estado, eu, j) {
  const antes = estado.pecaIndiceNoPercurso[j.pecaId];
  const m = matadasDaJogada(estado, j.sim, eu);
  const fim = terminouPeca(estado, j.sim, eu);
  const avanco = j.indiceDestino - antes;
  const compr = percursoPorJogador[eu].length;

  if (nivel === 'medio') {
    // 1.º matar, 2.º chegar ao centro, 3.º avançar a peça mais adiantada
    return m.n * 100 + m.valor * 0.5 + (fim ? 60 : 0) + avanco + j.indiceDestino * 0.2;
  }

  // avançado: mata, protege-se, e empurra as peças para o centro
  const naReta = j.indiceDestino >= compr - 10;        // casas coloridas: ninguém lá chega
  const exp = exposicao(j.sim, eu);
  return (
    m.n * 35 + m.valor * 1.2 +
    (fim ? 50 : 0) +
    avanco +
    (naReta ? 12 : 0) +
    j.indiceDestino * 0.3 -                            // favorece a peça mais adiantada
    exp * 1.1 +
    Math.random() * 0.5                                // desempate
  );
}

function escolherJogada(estado, nivel) {
  const eu = jogadorAtivoIndice(estado);
  const jogadas = jogadasValidas(estado);
  if (!jogadas.length) return null;

  let melhor;
  if (nivel === 'medio' || nivel === 'avancado') {
    let max = -Infinity;
    for (const j of jogadas) {
      const p = pontuar(nivel, estado, eu, j);
      if (p > max) { max = p; melhor = j; }
    }
  } else {
    melhor = jogadas[Math.floor(Math.random() * jogadas.length)];   // iniciante
  }
  return { pecaId: melhor.pecaId, destinoId: melhor.destinoId };
}

module.exports = { escolherJogada };
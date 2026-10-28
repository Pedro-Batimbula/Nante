<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Nante</title>
<style>
  :root{
    --cell: 44px;              /* tamanho de cada casa */
    --cellF: 70px;             /* faixa central (F1, F2, ...) mais larga */
    --azul: #3498db;      /* jogador 0 */
    --amarelo: #f1c40f;   /* jogador 1 */
    --roxo: #8420be;      /* jogador 2 */
    --vermelho: #e74c3c;  /* jogador 3 */
  }
  *{ box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body{
    margin: 0; height: 100%;
    background: #000;
    font-family: 'Trebuchet MS', Arial, sans-serif;
    overscroll-behavior: none;
  }

  /* Janela que ocupa o ecrã todo; o tabuleiro desliza dentro dela */
  #viewport{
    position: fixed; inset: 0;
    overflow: hidden;
    touch-action: none;   /* os gestos (arrastar/beliscar) são tratados pelo JS */
  }

  /* Tabuleiro: grelha 21x21 (9 + 3 + 9) */
  #board{
    display: grid;
    grid-template-columns: repeat(10, var(--cell)) var(--cellF) repeat(10, var(--cell));
    grid-template-rows: repeat(10, var(--cell)) var(--cellF) repeat(10, var(--cell));
    width: calc(var(--cell) * 20 + var(--cellF));
    height: calc(var(--cell) * 20 + var(--cellF));
    position: absolute; top: 0; left: 0;
    transform-origin: 0 0;
    will-change: transform;
    margin: 0;
    padding: 6px;
    background: linear-gradient(to bottom, rgb(22, 236, 19) 30%, rgb(0, 0, 0) 100%);
    border-radius: 14px;
    box-sizing: content-box;
  }

  /* Casas */
  .check{
    background: #f4f1f1;
    border: 1px solid #b5b5b5;
    display: flex; align-items: center; justify-content: center;
    font-size: calc(var(--cell) * 0.45); font-weight: 900; color: #000;
    line-height: 1; letter-spacing: -1px; overflow: hidden;
    user-select: none;
  }
  .check.F{ background: #f4f1f1; }
  .check.entrada{ background: #f4f1f1; color: #170101; }
  .check.j0{ background: var(--azul);     color: #fff; }
  .check.j1{ background: var(--amarelo);  color: #fff; }
  .check.j2{ background: var(--roxo);     color: #fff; }
  .check.j3{ background: var(--vermelho); color: #fff; }
  /* Caminhos finais com a cor do ninho, números pretos */
  .check.j0, .check.j1, .check.j2, .check.j3{ color: #000; }
  .check.win{ background: #f4f1f1; color: #000; }

  /* Bases (cantos) */
  .base{
    border-radius: 28px;
    box-shadow: inset 0 0 0 4px rgba(255,255,255,.35);
    display: flex; align-items: center; justify-content: center;
  }
  .base .inner{
    width: 72%; height: 72%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    place-items: center;
  }
  /* 4 anéis vazios em losango (cima, esquerda, direita, baixo) */
  .base .ninho{
    width: 52%; aspect-ratio: 1; border-radius: 50%;
    background: transparent;
    display: flex; align-items: center; justify-content: center;
    border: 4px solid rgba(255,255,255,.8);
    box-shadow: 0 0 0 3px rgba(0,0,0,.18), inset 0 0 0 3px rgba(0,0,0,.18);
  }
  .base .ninho:not(.ocupado){ border-color: transparent; box-shadow: none; }
  .base .ninho:nth-child(1){ grid-area: 1 / 2; }
  .base .ninho:nth-child(2){ grid-area: 2 / 1; }
  .base .ninho:nth-child(3){ grid-area: 2 / 3; }
  .base .ninho:nth-child(4){ grid-area: 3 / 2; }
  /* losango central */
  .base .inner::after{
    content: '';
    grid-area: 2 / 2;
    width: 28%; aspect-ratio: 1;
    background: rgba(255,255,255,.8);
    transform: rotate(45deg);
    border-radius: 4px;
  }
  .b0{ background: var(--azul); }
  .b1{ background: var(--amarelo); }
  .b2{ background: var(--roxo); }
  .b3{ background: var(--vermelho); }

  /* Peças */
  .peca{
    position: absolute; z-index: 5;
    width: calc(var(--cell) * 0.75); height: calc(var(--cell) * 0.75);
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 3px 0 rgba(0,0,0,.45), inset 0 -4px 6px rgba(0,0,0,.3);
    cursor: pointer;
    touch-action: manipulation;
  }
  .peca.p0{ background: radial-gradient(circle at 35% 30%, #8fcbf5, var(--azul)); }
  .peca.p1{ background: radial-gradient(circle at 35% 30%, #fbe98a, var(--amarelo)); }
  .peca.p2{ background: radial-gradient(circle at 35% 30%, #c78ae8, var(--roxo)); }
  .peca.p3{ background: radial-gradient(circle at 35% 30%, #f5a59b, var(--vermelho)); }
  .peca.no-ninho{ width: var(--cell); height: var(--cell); }
  .peca.terminada{ width: calc(var(--cell) * 0.4); height: calc(var(--cell) * 0.4); border-width: 2px; }
  .peca.pode-mover{ animation: pulsar 1s ease-in-out infinite; }
  .peca.selecionada{ animation: none; }
  /* com uma peça selecionada, as outras deixam passar o clique para a casa por baixo */
  .tem-selecao .peca:not(.selecionada){ pointer-events: none; }
  /* peça capturada: pisca e volta devagar ao ninho */
  .peca.capturada{
    transition: left .7s ease-in, top .7s ease-in;
    animation: capturada .6s ease-out;
  }
  @keyframes capturada{
    0%{ transform: scale(1.5); filter: brightness(2) saturate(2); }
    100%{ transform: scale(1); filter: none; }
  }
  /* explosão na casa onde houve a captura */
  .explosao{ position: absolute; width: 0; height: 0; z-index: 8; pointer-events: none; }
  .explosao::before{
    content: ''; position: absolute; left: -10px; top: -10px;
    width: 20px; height: 20px; border-radius: 50%;
    border: 4px solid #ff3b30;
    animation: onda .55s ease-out forwards;
  }
  .explosao i{
    position: absolute; left: -4px; top: -4px;
    width: 8px; height: 8px; border-radius: 50%; background: #ffd400;
    transform: rotate(var(--a)) translateX(0);
    animation: faisca .6s ease-out forwards;
  }
  @keyframes onda{ to{ transform: scale(4.5); opacity: 0; } }
  @keyframes faisca{ to{ transform: rotate(var(--a)) translateX(34px); opacity: 0; } }
  @keyframes pulsar{ 50%{ box-shadow: 0 0 0 5px #ffd400, 0 0 12px 4px rgba(255,212,0,.7); } }
  .bonus{
    min-width: 62px; height: 62px; border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    background: #ffd400; color: #000;
    font: 900 24px 'Trebuchet MS', Arial, sans-serif;
    box-shadow: 0 5px 0 #b39500, 0 9px 14px rgba(0,0,0,.35);
  }
  #vez{
    position: fixed; left: 50%; transform: translateX(-50%);
    top: calc(10px + env(safe-area-inset-top, 0px));
    max-width: 92vw; padding: 8px 18px; border-radius: 20px;
    border: 3px solid #fff; background: #fff; color: #000;
    font: bold 15px 'Trebuchet MS', Arial, sans-serif; text-align: center;
    box-shadow: 0 4px 10px rgba(0,0,0,.4);
    z-index: 100; pointer-events: none;
  }
  .peca.anima{ transition: left .25s ease, top .25s ease; }
  .peca.selecionada{
    transform: scale(1.2); z-index: 6;
    box-shadow: 0 0 0 4px #ffd400, 0 0 14px 6px rgba(255,212,0,.85);
  }

  .destino-possivel{ outline: 4px solid #000; outline-offset: -4px; cursor: pointer; }

  /* Centro */
  .centro{
    background: green;
    border: 1px solid #bbb;
  }
  /* ===== Botão GIRAR (fixo, em baixo à direita) ===== */
  #btnGirar{
    position: fixed;
    right: calc(16px + env(safe-area-inset-right, 0px));
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    width: 84px; height: 84px;
    border-radius: 50%;
    border: 3px solid #fff;
    background: linear-gradient(to bottom, rgb(14, 29, 194) 30%, rgb(0, 0, 0) 100%);
    color: #fff;
    font: bold 17px 'Trebuchet MS', Arial, sans-serif;
    letter-spacing: .5px;
    box-shadow: 0 6px 0 #000, 0 10px 18px rgba(0,0,0,.35);
    z-index: 100;
    cursor: pointer;
    touch-action: manipulation;
  }
  #btnGirar:active{ transform: translateY(4px); box-shadow: 0 2px 0 #000, 0 4px 10px rgba(0,0,0,.35); }
  #btnGirar:disabled{ opacity: .7; }

  /* ===== Dois dados (fixos, em baixo à esquerda) ===== */
  #dados{
    position: fixed;
    left: calc(16px + env(safe-area-inset-left, 0px));
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    display: flex; gap: 12px; flex-wrap: wrap-reverse; max-width: calc(100vw - 140px);
    z-index: 100;
    pointer-events: none;
  }
  .dado{
    --pip: #1e5bd8;                 /* pontos azuis */
    width: 62px; height: 62px;
    background: linear-gradient(145deg, #ffffff 0%, #e9eefc 100%);
    border-radius: 14px;
    box-shadow: 0 5px 0 #b4bfdc, 0 9px 14px rgba(0,0,0,.35);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    place-items: center;
    padding: 9px;
  }
  .dado.v1, .dado.v4{ --pip: #e53935; }   /* 1 e 4 -> vermelho */
  .dado .pip{
    width: 11px; height: 11px; border-radius: 50%;
    background: var(--pip);
  }
  .dado.v1 .pip{ width: 15px; height: 15px; }
  .dado.rolando{ animation: abanar .18s linear infinite; }
  @keyframes abanar{
    0%   { transform: rotate(0deg)  translateY(0); }
    25%  { transform: rotate(-12deg) translateY(-4px); }
    75%  { transform: rotate(12deg)  translateY(-4px); }
    100% { transform: rotate(0deg)  translateY(0); }
  }
</style>
</head>
<body>

<div id="viewport">
  <div id="board"></div>
</div>

<div id="vez"></div>

<div id="dados">
  <div class="dado" id="dado1"></div>
  <div class="dado" id="dado2"></div>
</div>
<button id="btnGirar" type="button">GIRAR</button>

<script>var module = { exports: {} };</script>
<script src="regras.js"></script>
<script>
(function () {
  const Regras = module.exports;
  const board = document.getElementById('board');
  const viewport = document.getElementById('viewport');

  // Cada casa: [linha, coluna, id, classe extra, texto]
  const cells = [];
  function add(r, c, id, cls, txt) { cells.push({ r, c, id, cls: cls || '', txt: txt == null ? '' : txt }); }

  // Rótulos 6..14, F, 16..19, 1..4 etc. (a partir do id)
  function rot(id) {
    const m = id.match(/(\d+)$/);
    if (/F$/.test(id) && !m) return 'F';
    return m ? m[1] : 'F';
  }
  function tipoF(id) { return /(HE10|HEF|VTF|VT10|VBF10|VBF|HDF|HD10)$/.test(id) ? 'F' : ''; }

  /* ===== Braço ESQUERDO (linhas 9-11, colunas 0-8) ===== */
  ['HE14','HE13','HE12','HE11','HE10','HE9','HE8','HE7','HE6']
    .forEach((id, i) => add(9, i, id, tipoF(id), id === 'HE10' ? 'F' : rot(id)));
  add(10, 0, 'MHEF', 'entrada', 'F');
  for (let i = 1; i <= 8; i++) add(10, i, 'MHEF' + i, 'j3', 'F' + i);
  ['HE16','HE17','HE18','HE19','HEF','HE1','HE2','HE3','HE4']
    .forEach((id, i) => add(11, i, id, tipoF(id), id === 'HEF' ? 'F' : rot(id)));

  /* ===== Braço DIREITO (linhas 9-11, colunas 12-20) ===== */
  ['HD4','HD3','HD2','HD1','HDF','HD19','HD18','HD17','HD16']
    .forEach((id, i) => add(9, 12 + i, id, tipoF(id), id === 'HDF' ? 'F' : rot(id)));
  for (let i = 8; i >= 1; i--) add(10, 12 + (8 - i), 'MHD' + i, 'j1', 'F' + i);
  add(10, 20, 'MHDF', 'entrada', 'F');
  ['HD6','HD7','HD8','HD9','HD10','HD11','HD12','HD13','HD14']
    .forEach((id, i) => add(11, 12 + i, id, tipoF(id), id === 'HD10' ? 'F' : rot(id)));

  /* ===== Braço TOPO (colunas 9-11, linhas 0-8) ===== */
  ['VT16','VT17','VT18','VT19','VTF','VT1','VT2','VT3','VT4']
    .forEach((id, i) => add(i, 9, id, tipoF(id), id === 'VTF' ? 'F' : rot(id)));
  add(0, 10, 'MVF', 'entrada', 'F');
  for (let i = 1; i <= 8; i++) add(i, 10, 'MV' + i, 'j2', 'F' + i);
  ['VT14','VT13','VT12','VT11','VT10','VT9','VT8','VT7','VT6']
    .forEach((id, i) => add(i, 11, id, tipoF(id), id === 'VT10' ? 'F' : rot(id)));

  /* ===== Braço BAIXO (colunas 9-11, linhas 12-20) ===== */
  ['VB6','VB7','VB8','VB9','VBF10','VB11','VB12','VB13','VB14']
    .forEach((id, i) => add(12 + i, 9, id, tipoF(id), id === 'VBF10' ? 'F' : rot(id)));
  for (let i = 8; i >= 1; i--) add(12 + (8 - i), 10, 'MVB' + i, 'j0', 'F' + i);
  add(20, 10, 'MVBF', 'entrada', 'F');
  ['VB4','VB3','VB2','VB1','VBF','VB19','VB18','VB17','VB16']
    .forEach((id, i) => add(12 + i, 11, id, tipoF(id), id === 'VBF' ? 'F' : rot(id)));

  /* ===== Centro 3x3 ===== */
  add(9, 9,  'VTE5',  'win', '5');
  add(9, 10, 'MVTF9', 'j2',  'F9');
  add(9, 11, 'VTD9',  'win', '5');
  add(10, 9,  'MEF9', 'j3',  'F9');
  add(10, 11, 'MDF9', 'j1',  'F9');
  add(11, 9,  'VBE5', 'win', '5');
  add(11, 10, 'MVBF9','j0',  'F9');
  add(11, 11, 'VBD5', 'win', '5');

  // Desenhar casas
  cells.forEach(({ r, c, id, cls, txt }) => {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'check ' + cls;
    el.style.gridRow = (r + 1);
    el.style.gridColumn = (c + 1);
    el.textContent = txt;
    board.appendChild(el);
  });

  // Centro (ninho-4) no meio do 3x3
  const centro = document.createElement('div');
  centro.id = 'ninho-4';
  centro.className = 'centro';
  centro.style.gridRow = 11;
  centro.style.gridColumn = 11;
  board.appendChild(centro);

  // Bases (mesma convenção do teu jogo):
  // 0 azul baixo-direita | 1 amarelo topo-direita | 2 roxo topo-esquerda | 3 vermelho baixo-esquerda
  const PECAS_POR_JOGADOR = 4;   // máximo 4 (há 4 anéis por ninho)
  const bases = [
    { j: 0, r: 12, c: 12 },
    { j: 1, r: 0,  c: 12 },
    { j: 2, r: 0,  c: 0  },
    { j: 3, r: 12, c: 0  }
  ];
  bases.forEach(({ j, r, c }) => {
    const b = document.createElement('div');
    b.className = 'base b' + j;
    b.id = 'ninho-' + j;
    b.style.gridRow = (r + 1) + ' / span 9';
    b.style.gridColumn = (c + 1) + ' / span 9';
    b.innerHTML = '<div class="inner"><div class="ninho"></div><div class="ninho"></div><div class="ninho"></div><div class="ninho"></div></div>';
    board.appendChild(b);

    // Peças deste jogador nos ninhos
    const slots = b.querySelectorAll('.ninho');
    for (let i = 0; i < Math.min(PECAS_POR_JOGADOR, slots.length); i++) {
      const p = document.createElement('div');
      p.className = 'peca p' + j;
      p.id = 'P' + (j + 1) + '-' + i;   // mesmo id que o motor usa
      p.dataset.peca = i;
      p.dataset.jogador = j;
      p.dataset.casa = 'ninho-' + j;
      board.appendChild(p);
      p._casa = slots[i];   // casa onde a peça está (no início, o anel de origem)
    }
  });

   /* ===== Jogo local com as regras do regras.js (4 jogadores) ===== */
  const NOMES = ['Azul', 'Amarelo', 'Roxo', 'Vermelho'];
  const CORES = ['var(--azul)', 'var(--amarelo)', 'var(--roxo)', 'var(--vermelho)'];
  const estado = Regras.criarEstadoInicial(4, PECAS_POR_JOGADOR);
  const pecas = Array.from(board.querySelectorAll('.peca'));
  const ocupantes = new Map();   // elemento da casa -> [peças lá dentro]
  let selecionada = null;

  // Casas finais ninho-4-0..3 dentro do centro (só cria se ainda não existirem)
  if (!document.getElementById('ninho-4-0')) {
    centro.style.display = 'grid';
    centro.style.gridTemplate = '1fr 1fr / 1fr 1fr';
    [[2, '1 / 1'], [1, '1 / 2'], [3, '2 / 1'], [0, '2 / 2']].forEach(([j, area]) => {
      const q = document.createElement('div');
      q.id = 'ninho-4-' + j;
      q.className = 'final';
      q.style.gridArea = area;
      q.style.background = CORES[j];
      centro.appendChild(q);
    });
  }

  // Elemento onde a peça deve ficar, a partir do id da casa que o motor indica
  function elementoDaCasa(casaId, p) {
    if (casaId.startsWith('ninho-') && !casaId.startsWith('ninho-4-')) {
      return document.getElementById(casaId).querySelectorAll('.ninho')[Number(p.dataset.peca)];
    }
    return document.getElementById(casaId);
  }

  // Centra as peças de uma casa (se houver várias, espalha-as à volta do centro)
  function arrumar(casa) {
    const lista = ocupantes.get(casa) || [];
    const n = lista.length;
    casa.classList.toggle('ocupado', n > 0);
    lista.forEach((p, i) => {
      p.classList.toggle('no-ninho', casa.classList.contains('ninho'));
      p.classList.toggle('terminada', casa.id.startsWith('ninho-4-'));
      let dx = 0, dy = 0;
      if (n > 1 && casa.id.startsWith('ninho-4-')) {
        // casa final: até 4 peças pequenas em 2x2
        [dx, dy] = [[-8, -8], [8, 8], [8, -8], [-8, 8]][i] || [0, 0];
      } else if (n > 1) {
        const ang = (2 * Math.PI / n) * i - Math.PI / 2;
        dx = Math.cos(ang) * 9; dy = Math.sin(ang) * 9;
      }
      p.style.left = (casa.offsetLeft + casa.offsetWidth / 2 + dx - p.offsetWidth / 2) + 'px';
      p.style.top  = (casa.offsetTop + casa.offsetHeight / 2 + dy - p.offsetHeight / 2) + 'px';
    });
  }

  // Brilho nas peças da vez que têm jogada possível
  function marcarPodeMover() {
    const ativo = Regras.jogadorAtivoIndice(estado);
    pecas.forEach(p => {
      const mapa = estado.destinosPorPeca[p.id];
      p.classList.toggle('pode-mover',
        !estado.jogoTerminado && Number(p.dataset.jogador) === ativo && !!mapa && Object.keys(mapa).length > 0);
    });
  }

  // Desenha TUDO a partir do estado do motor
  const localAnterior = {};   // id da peça -> id da casa no desenho anterior
  const ehNinhoDePartida = id => id.startsWith('ninho-') && !id.startsWith('ninho-4-');

  // Explosão no centro de uma casa
  function efeitoCaptura(casa) {
    const fx = document.createElement('div');
    fx.className = 'explosao';
    fx.style.left = (casa.offsetLeft + casa.offsetWidth / 2) + 'px';
    fx.style.top = (casa.offsetTop + casa.offsetHeight / 2) + 'px';
    for (let k = 0; k < 8; k++) {
      const f = document.createElement('i');
      f.style.setProperty('--a', (k * 45) + 'deg');
      fx.appendChild(f);
    }
    board.appendChild(fx);
    setTimeout(() => fx.remove(), 800);
  }

  // Desenha TUDO a partir do estado do motor e devolve as peças que acabaram de ser capturadas
  function renderizar() {
    ocupantes.clear();
    const capturadas = [];
    pecas.forEach(p => {
      const casaId = estado.pecaLocalizacao[p.id];
      if (!casaId) return;
      const antes = localAnterior[p.id];
      if (antes && !ehNinhoDePartida(antes) && ehNinhoDePartida(casaId)) {
        capturadas.push({ p, casaAntes: document.getElementById(antes) });
      }
      localAnterior[p.id] = casaId;
      const el = elementoDaCasa(casaId, p);
      if (el) ocupantes.set(el, [...(ocupantes.get(el) || []), p]);
    });
    board.querySelectorAll('.ninho.ocupado').forEach(el => { if (!ocupantes.has(el)) el.classList.remove('ocupado'); });
    ocupantes.forEach((_, casa) => arrumar(casa));
    marcarPodeMover();

    // Efeitos: uma explosão por casa, e a peça capturada pisca e regressa ao ninho
    new Set(capturadas.map(c => c.casaAntes)).forEach(casa => { if (casa) efeitoCaptura(casa); });
    capturadas.forEach(({ p }) => {
      p.classList.add('capturada');
      setTimeout(() => p.classList.remove('capturada'), 700);
    });
    return capturadas.map(c => c.p);
  }

  function atualizarVez(msg) {
    const el = document.getElementById('vez');
    if (estado.jogoTerminado) {
      const ordem = estado.jogadores.filter(p => p.classificacao !== null)
        .sort((a, b) => a.classificacao - b.classificacao)
        .map(p => p.classificacao + 'º ' + NOMES[p.indice]);
      el.style.background = '#fff';
      el.textContent = 'Fim de jogo: ' + ordem.join(' · ');
      return;
    }
    const j = Regras.jogadorAtivoIndice(estado);
    el.style.background = CORES[j];
    el.textContent = 'Vez: ' + NOMES[j] + (msg ? ' · ' + msg : '');
  }

  function limparSelecao() {
    if (selecionada) selecionada.classList.remove('selecionada');
    selecionada = null;
    board.classList.remove('tem-selecao');
    board.querySelectorAll('.destino-possivel').forEach(el => el.classList.remove('destino-possivel'));
  }

  function selecionar(p) {
    limparSelecao();
    selecionada = p;
    p.classList.add('selecionada');
    board.classList.add('tem-selecao');
    // só as casas que o motor permite para esta peça
    Object.keys(estado.destinosPorPeca[p.id] || {}).forEach(casaId => {
      const el = document.getElementById(casaId);
      if (el) el.classList.add('destino-possivel');
    });
  }

  // Clique numa peça: só as da vez com jogada possível
  pecas.forEach(p => {
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selecionada === p) { limparSelecao(); return; }
      if (!p.classList.contains('pode-mover')) { atualizarVez('essa peça não pode mexer agora'); return; }
      selecionar(p);
    });
  });

  // Clique numa casa de destino: o motor valida e aplica (capturas, bónus, vez)
  // Aplica o movimento da peça selecionada para a casa indicada (o motor valida)
  function executarMovimento(casaId) {
    if (!selecionada) return;
    const alvo = document.getElementById(casaId);
    if (!alvo || !alvo.classList.contains('destino-possivel')) return;

    const p = selecionada;
    const antes = Regras.jogadorAtivoIndice(estado);
    const r = Regras.moverPeca(estado, p.id, casaId);
    limparSelecao();
    if (!r.sucesso) { atualizarVez(r.motivo); return; }

    const capturadas = renderizar();
    const depois = Regras.jogadorAtivoIndice(estado);
    const pendente = estado.dadosDisponiveis.length > 0 || estado.bonusesCaptura.length > 0;
    if (pendente) mostrarDados(estado.dadosDisponiveis, estado.bonusesCaptura);
    const aviso = capturadas.length
      ? NOMES[antes] + ' capturou ' + capturadas.length + (capturadas.length > 1 ? ' peças' : ' peça') + '! '
      : '';
    atualizarVez(aviso + (pendente ? 'ainda tens jogadas'
      : depois !== antes ? NOMES[antes] + ' terminou' : 'joga outra vez'));
    atualizarBotao();
  }

  board.addEventListener('click', (e) => {
    const alvo = e.target.closest('.check, [id^="ninho-4-"]');
    if (alvo) executarMovimento(alvo.id);
  });

  renderizar();
  atualizarVez();
  requestAnimationFrame(() => pecas.forEach(p => p.classList.add('anima')));
  /* ===== Zoom (beliscar / roda) e arrastar ===== */
  const MAX_ESCALA = 2.2;          // zoom máximo (aproximar)
  let escalaMin = 0.4;             // zoom mínimo = tabuleiro inteiro no ecrã (calculado)
  let escala = 1, x = 0, y = 0;

  function dims() {
    return { bw: board.offsetWidth, bh: board.offsetHeight, vw: viewport.clientWidth, vh: viewport.clientHeight };
  }

  // Impede de sair do tabuleiro; se couber no ecrã, fica centrado (por isso "desce" ao meio)
  function limitar() {
    const { bw, bh, vw, vh } = dims();
    const w = bw * escala, h = bh * escala;
    x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, x));
    y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, y));
  }

  function aplicar() {
    limitar();
    board.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + escala + ')';
  }

  function calcularMinimo() {
    const { bw, bh, vw, vh } = dims();
    escalaMin = Math.min(vw / bw, vh / bh) * 0.98;
  }

  function zoomEm(novaEscala, cx, cy) {
    novaEscala = Math.min(MAX_ESCALA, Math.max(escalaMin, novaEscala));
    const k = novaEscala / escala;
    x = cx - (cx - x) * k;   // mantém o ponto sob os dedos parado
    y = cy - (cy - y) * k;
    escala = novaEscala;
    aplicar();
  }

  // Arrastar (1 dedo) e beliscar (2 dedos)
  const pointers = new Map();
  let distAnterior = null;
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  let inicio = null;
  viewport.addEventListener('pointerdown', (e) => {
    inicio = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) distAnterior = dist(...pointers.values());
  });

  viewport.addEventListener('pointermove', (e) => {
    const anterior = pointers.get(e.pointerId);
    if (!anterior) return;
    const atual = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, atual);

    if (pointers.size === 1) {
      if (inicio && !viewport.hasPointerCapture(e.pointerId) &&
          Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 8) {
        viewport.setPointerCapture(e.pointerId);
      }
      x += atual.x - anterior.x;
      y += atual.y - anterior.y;
      aplicar();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = dist(a, b);
      if (distAnterior) zoomEm(escala * (d / distAnterior), (a.x + b.x) / 2, (a.y + b.y) / 2);
      distAnterior = d;
    }
  });

  function soltar(e) {
    pointers.delete(e.pointerId);
    distAnterior = null;
  }
  viewport.addEventListener('pointerup', soltar);
  viewport.addEventListener('pointercancel', soltar);

  // Roda do rato (para testar no computador)
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomEm(escala * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
  }, { passive: false });

  // Início: tabuleiro inteiro visível e centrado
  function iniciar() {
    calcularMinimo();
    escala = escalaMin;
    aplicar();
  }
  function aoRedimensionar() {
    calcularMinimo();
    escala = Math.max(escala, escalaMin);
    aplicar();
  }
  window.addEventListener('load', iniciar);
  window.addEventListener('resize', aoRedimensionar);
  window.addEventListener('orientationchange', () => setTimeout(aoRedimensionar, 300));

  /* ===== Dados + botão GIRAR ===== */
  const btnGirar = document.getElementById('btnGirar');
  const dadosBox = document.getElementById('dados');

  // Posições dos pontos numa grelha 3x3 (1..9, da esquerda p/ a direita, de cima p/ baixo)
  const PONTOS = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
  };

  function desenharDado(el, valor) {
    el.className = 'dado v' + valor + (el.classList.contains('rolando') ? ' rolando' : '');
    el.innerHTML = '';
    PONTOS[valor].forEach(pos => {
      const p = document.createElement('div');
      p.className = 'pip';
      p.style.gridArea = Math.ceil(pos / 3) + ' / ' + (((pos - 1) % 3) + 1);
      el.appendChild(p);
    });
  }

  const sortear = () => 1 + Math.floor(Math.random() * 6);

  // Mostra N dados (e fichas de bónus, ex.: +20) e devolve os elementos dos dados
  function mostrarDados(valores, bonus) {
    dadosBox.innerHTML = '';
    const els = valores.map(v => {
      const el = document.createElement('div');
      dadosBox.appendChild(el);
      desenharDado(el, v);
      return el;
    });
    (bonus || []).forEach(b => {
      const c = document.createElement('div');
      c.className = 'bonus';
      c.textContent = '+' + b;
      dadosBox.appendChild(c);
    });
    return els;
  }
  mostrarDados([]);

  let girando = false;

  function podeGirar() {
    return !girando && !estado.jogoTerminado &&
      estado.dadosDisponiveis.length === 0 && estado.bonusesCaptura.length === 0;
  }
  function atualizarBotao() { btnGirar.disabled = !podeGirar(); }

  btnGirar.addEventListener('click', () => {
    if (!podeGirar()) return;
    girando = true;
    limparSelecao();
    atualizarBotao();

    const antes = Regras.jogadorAtivoIndice(estado);
    const n = estado.quantidadeProximaRolagem || estado.quantidadeBase;
    const els = mostrarDados(Array.from({ length: n }, sortear));
    els.forEach(el => el.classList.add('rolando'));

    let voltas = 0;
    const timer = setInterval(() => {
      els.forEach(el => desenharDado(el, sortear()));
      if (++voltas < 10) return;
      clearInterval(timer);

      // O motor decide tudo: valores, entradas automáticas com 6, vez e destinos
      const dados = Regras.rolarDados(estado);
      girando = false;
      mostrarDados(dados);
      renderizar();

      const depois = Regras.jogadorAtivoIndice(estado);
      const pendente = estado.dadosDisponiveis.length > 0 || estado.bonusesCaptura.length > 0;
      let texto = NOMES[antes] + ' tirou ' + dados.join(' + ');
      if (pendente) texto += ' — escolhe uma peça';
      else texto += depois !== antes ? ' — passa a vez' : ' — joga outra vez';
      atualizarVez(texto);
      atualizarBotao();
    }, 80);
  });

  atualizarBotao();
})();
</script>
</body>
</html>

// Painel de admin do Nante: mostra o histórico real de jogos (lido do Neon).
// Protegido por palavra-passe: define ADMIN_PASSWORD no .env (e no Render).
// Uso no server.js:  require('./admin')(app);

const crypto = require('crypto');
const historico = require('./historico');

function igual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function autenticar(req, res, next) {
  const senha = process.env.ADMIN_PASSWORD;
  if (!senha) return res.status(503).send('Define ADMIN_PASSWORD no .env para abrir o admin.');
  const partes = (req.headers.authorization || '').split(' ');
  if (partes[0] === 'Basic' && partes[1]) {
    const texto = Buffer.from(partes[1], 'base64').toString('utf8');
    if (igual(texto.slice(texto.indexOf(':') + 1), senha)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Nante admin"');
  res.status(401).send('Autenticação necessária.');
}

module.exports = function (app) {
  app.get('/admin', autenticar, (req, res) => res.type('html').send(PAGINA));
  app.get('/admin/dados', autenticar, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(historico.resumo());
  });
};

// NOTA: o código da página abaixo não usa crases nem ${...}, porque está dentro de um template literal.
const PAGINA = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nante – histórico de jogos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--fundo:#eef1f5;--tinta:#1d2433;--suave:#5d6779;--linha:#d3d9e3;--painel:#fff;--vermelho:#d94a4a;--verde:#2f9e6a;--amarelo:#c58f12;--azul:#3a73d6}
@media (prefers-color-scheme:dark){:root{--fundo:#141a26;--tinta:#e8ecf3;--suave:#9aa5b8;--linha:#2a3346;--painel:#1b2333;--amarelo:#e0a526}}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--tinta);font:15px/1.45 Rubik,system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:26px;font-weight:600;margin:0 0 4px}
.sub{color:var(--suave);margin:0 0 22px;font-size:14px}
.totais{display:flex;flex-wrap:wrap;border:1px solid var(--linha);border-radius:10px;background:var(--painel);margin-bottom:24px;overflow:hidden}
.totais div{flex:1 1 120px;padding:14px 16px;border-right:1px solid var(--linha)}
.totais div:last-child{border-right:0}
.totais b{display:block;font-size:26px;font-weight:600;font-variant-numeric:tabular-nums}
.totais span{color:var(--suave);font-size:13px}
h2{font-size:16px;font-weight:600;margin:0 0 10px}
.dias{display:grid;gap:6px;margin-bottom:28px}
.dia{display:grid;grid-template-columns:52px 1fr 34px;align-items:center;gap:10px;font-size:13px;color:var(--suave)}
.dia i{display:block;height:8px;border-radius:4px;background:var(--azul)}
.dia b{font-weight:500;color:var(--tinta);text-align:right;font-variant-numeric:tabular-nums}
.barra{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.barra button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid var(--linha);border-radius:999px;background:var(--painel);color:var(--tinta);cursor:pointer}
.barra button[aria-pressed=true]{background:var(--tinta);color:var(--fundo);border-color:var(--tinta)}
.barra input{font:inherit;font-size:14px;flex:1 1 180px;min-width:0;padding:7px 12px;border:1px solid var(--linha);border-radius:8px;background:var(--painel);color:var(--tinta)}
button:focus-visible,input:focus-visible{outline:2px solid var(--azul);outline-offset:2px}
.lista{border:1px solid var(--linha);border-radius:10px;background:var(--painel);overflow:hidden}
.linha{display:grid;grid-template-columns:56px 118px 84px 112px 1fr;gap:10px;padding:11px 16px;border-top:1px solid var(--linha);align-items:center;font-size:14px}
.linha:first-child{border-top:0}
.cab{color:var(--suave);font-size:13px;background:transparent}
.n{font-variant-numeric:tabular-nums;color:var(--suave)}
.est{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.est i{width:8px;height:8px;border-radius:50%;display:inline-block}
.jogs{display:flex;flex-wrap:wrap;gap:4px 14px}
.jog{display:inline-flex;align-items:center;gap:6px}
.jog i{width:10px;height:10px;border-radius:3px;display:inline-block}
.jog.saiu{color:var(--suave);text-decoration:line-through}
.vazio{padding:28px 16px;color:var(--suave)}
.nota{color:var(--suave);font-size:13px;margin-top:10px}
@media (max-width:700px){
  .cab{display:none}
  .linha{grid-template-columns:1fr auto;gap:4px 10px}
  .linha .jogs{grid-column:1 / -1}
}
</style>
</head>
<body>
<main>
  <h1>Histórico de jogos</h1>
  <p class="sub" id="atualizado">A carregar…</p>

  <div class="totais" id="totais"></div>

  <h2>Jogos por dia</h2>
  <div class="dias" id="dias"></div>

  <h2>Jogos</h2>
  <div class="barra" id="filtros">
    <button data-f="todos" aria-pressed="true">Todos</button>
    <button data-f="em curso" aria-pressed="false">A decorrer</button>
    <button data-f="terminado" aria-pressed="false">Terminados</button>
    <button data-f="abandonado" aria-pressed="false">Abandonados</button>
    <button data-f="interrompido" aria-pressed="false">Interrompidos</button>
    <input id="busca" type="search" placeholder="Procurar por jogador ou sala">
  </div>
  <div class="lista" id="lista"></div>
  <p class="nota" id="nota"></p>
</main>

<script>
var NOMES = { 'em curso': 'A decorrer', 'terminado': 'Terminado', 'abandonado': 'Abandonado', 'interrompido': 'Interrompido' };
var COR_ESTADO = { 'em curso': 'var(--azul)', 'terminado': 'var(--verde)', 'abandonado': 'var(--vermelho)', 'interrompido': 'var(--amarelo)' };
var COR_LUGAR = ['#d94a4a', '#2f9e6a', '#e0a526', '#3a73d6'];
var MAX_LINHAS = 200;
var dados = null, filtro = 'todos';

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
}

function fmtData(iso) {
  return new Date(iso).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function duracao(j) {
  if (!j.fim) return '–';
  var min = Math.round((new Date(j.fim) - new Date(j.inicio)) / 60000);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}

function jogadoresHtml(j) {
  return (j.jogadores || []).slice().sort(function (a, b) {
    return (a.classificacao || 99) - (b.classificacao || 99) || a.indice - b.indice;
  }).map(function (p) {
    return '<span class="jog' + (p.abandonou ? ' saiu' : '') + '"><i style="background:' + COR_LUGAR[p.indice % 4] + '"></i>' +
      (p.classificacao ? p.classificacao + '.º ' : '') + esc(p.nome) + (p.abandonou ? ' (saiu)' : '') + '</span>';
  }).join('');
}

function render() {
  if (!dados) return;
  var jogos = dados.jogos;

  var cont = { 'em curso': 0, 'terminado': 0, 'abandonado': 0, 'interrompido': 0 };
  jogos.forEach(function (j) { cont[j.estado] = (cont[j.estado] || 0) + 1; });
  document.getElementById('totais').innerHTML =
    '<div><b>' + dados.total + '</b><span>Total</span></div>' +
    '<div><b>' + cont['em curso'] + '</b><span>A decorrer</span></div>' +
    '<div><b>' + cont['terminado'] + '</b><span>Terminados</span></div>' +
    '<div><b>' + (cont['abandonado'] + cont['interrompido']) + '</b><span>Abandonados ou interrompidos</span></div>';

  var dias = dados.dias.slice(0, 14);
  var max = dias.reduce(function (m, d) { return Math.max(m, d.jogos); }, 1);
  document.getElementById('dias').innerHTML = dias.length ? dias.map(function (d) {
    return '<div class="dia"><span>' + d.dia.slice(8) + '/' + d.dia.slice(5, 7) + '</span><i style="width:' + Math.max(2, d.jogos / max * 100) + '%"></i><b>' + d.jogos + '</b></div>';
  }).join('') : '<div class="vazio">Sem jogos registados.</div>';

  var q = document.getElementById('busca').value.trim().toLowerCase();
  var vistos = jogos.filter(function (j) {
    if (filtro !== 'todos' && j.estado !== filtro) return false;
    if (!q) return true;
    if (String(j.salaId).toLowerCase().indexOf(q) >= 0) return true;
    return (j.jogadores || []).some(function (p) { return String(p.nome).toLowerCase().indexOf(q) >= 0; });
  });

  var html = '<div class="linha cab"><span>Jogo</span><span>Início</span><span>Duração</span><span>Estado</span><span>Jogadores</span></div>';
  html += vistos.slice(0, MAX_LINHAS).map(function (j) {
    return '<div class="linha"><span class="n">#' + j.id + '</span><span>' + fmtData(j.inicio) + '</span><span class="n">' + duracao(j) + '</span>' +
      '<span class="est"><i style="background:' + (COR_ESTADO[j.estado] || 'var(--suave)') + '"></i>' + esc(NOMES[j.estado] || j.estado) + '</span>' +
      '<span class="jogs">' + jogadoresHtml(j) + '</span></div>';
  }).join('');
  if (!vistos.length) html = '<div class="vazio">' + (jogos.length ? 'Nenhum jogo com este filtro.' : 'Ainda não há jogos. Quando alguém jogar uma partida, aparece aqui.') + '</div>';
  document.getElementById('lista').innerHTML = html;
  document.getElementById('nota').textContent = vistos.length > MAX_LINHAS ? 'A mostrar os ' + MAX_LINHAS + ' mais recentes de ' + vistos.length + '.' : '';
}

function carregar() {
  fetch('/admin/dados', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      dados = d;
      document.getElementById('atualizado').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-PT', { timeZone: 'Africa/Luanda' }) + ' e a atualizar a cada 10 segundos.';
      render();
    })
    .catch(function () {
      document.getElementById('atualizado').textContent = 'Não foi possível ler os dados. Recarrega a página.';
    });
}

document.getElementById('filtros').addEventListener('click', function (e) {
  var f = e.target.getAttribute && e.target.getAttribute('data-f');
  if (!f) return;
  filtro = f;
  Array.prototype.forEach.call(this.querySelectorAll('button'), function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-f') === f ? 'true' : 'false');
  });
  render();
});
document.getElementById('busca').addEventListener('input', render);

carregar();
setInterval(carregar, 10000);
</script>
</body>
</html>`;

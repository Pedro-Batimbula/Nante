// Painel de admin do Nante: mostra o histórico real de jogos (lido do Neon).
// Protegido por palavra-passe: define ADMIN_PASSWORD no .env (e no Render).
// Uso no server.js:  require('./admin')(app);

const crypto = require('crypto');
const historico = require('./historico');
const contas = require('./contas');
const express = require('express');
const json = express.json({ limit: '10kb' });

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

  // ===== Dinheiro real (KZ): depósitos =====
  app.get('/admin/kz', autenticar, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      numero: await contas.numeroDeposito(),
      pendentes: await contas.listarDepositosPendentes()
    });
  });
  app.post('/admin/kz/numero', autenticar, json, async (req, res) => {
    if (!req.is('application/json')) return res.status(400).json({ erro: 'Pedido inválido.' });
    const r = await contas.definirNumeroDeposito(req.body && req.body.numero);
    res.status(r.erro ? 400 : 200).json(r);
  });
  app.get('/admin/kz/foto/:id', autenticar, async (req, res) => {
    const foto = await contas.fotoDeposito(req.params.id);
    if (!foto) return res.status(404).send('Sem foto.');
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.send(foto);
  });
  // ===== Dinheiro real (KZ): levantamentos =====
  app.get('/admin/kz/resumo', autenticar, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = await contas.resumoKz();
    if (!r) return res.status(500).json({ erro: 'Sem dados.' });
    res.json(r);
  });
  app.get('/admin/kz/levantamentos', autenticar, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ pendentes: await contas.listarLevantamentosPendentes() });
  });
  app.post('/admin/kz/levantamento/decidir', autenticar, json, async (req, res) => {
    if (!req.is('application/json')) return res.status(400).json({ erro: 'Pedido inválido.' });
    const b = req.body || {};
    const r = await contas.decidirLevantamento(b.id, b.pago === true);
    res.status(r.erro ? 400 : 200).json(r);
  });
  app.post('/admin/kz/decidir', autenticar, json, async (req, res) => {
    if (!req.is('application/json')) return res.status(400).json({ erro: 'Pedido inválido.' });
    const b = req.body || {};
    const r = await contas.decidirDeposito(b.id, b.confirmar === true);
    res.status(r.erro ? 400 : 200).json(r);
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
.kz{margin-bottom:28px}
#kzBadge{margin-left:8px;font-size:13px;font-weight:500;color:var(--amarelo)}
.kz-config{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.kz-config input{font:inherit;font-size:14px;flex:1 1 200px;min-width:0;padding:7px 12px;border:1px solid var(--linha);border-radius:8px;background:var(--painel);color:var(--tinta)}
.kz-config button,.kz-botoes button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid var(--linha);border-radius:8px;background:var(--painel);color:var(--tinta);cursor:pointer}
.kz-item{padding:12px 16px;border-top:1px solid var(--linha)}
.kz-item:first-child{border-top:0}
.kz-topo{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.kz-valor{font-weight:600;color:var(--verde);font-variant-numeric:tabular-nums}
.kz-botoes{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.kz-botoes .ok{background:var(--verde);color:#fff;border-color:var(--verde)}
.kz-botoes .no{color:var(--vermelho);border-color:var(--vermelho)}
.kz-foto{display:block;max-width:100%;max-height:70vh;margin-top:10px;border-radius:8px;border:1px solid var(--linha)}
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

  <h2>Conta geral</h2>
  <div class="totais" id="kzResumo"></div>
  <p class="nota" id="kzConfere" style="margin:-14px 0 24px"></p>

  <section class="kz">
    <h2>Depósitos KZ<span id="kzBadge"></span></h2>
    <div class="kz-config">
      <input id="kzNumero" type="text" maxlength="40" placeholder="Número para receber depósitos (Express)">
      <button id="kzNumeroBtn" type="button">Guardar número</button>
      <span id="kzMsg" class="nota"></span>
    </div>
    <div class="lista" id="kzLista"></div>
  </section>

  <section class="kz">
    <h2>Levantamentos KZ<span id="levBadge" style="margin-left:8px;font-size:13px;font-weight:500;color:var(--amarelo)"></span></h2>
    <div class="lista" id="levLista"></div>
  </section>

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

var kzAbertos = {}, kzSig = '';
var kzNDep = 0, kzNLev = 0;
function kzTitulo() {
  var t = kzNDep + kzNLev;
  document.title = (t ? '(' + t + ') ' : '') + 'Nante – admin';
}

function kzCarregar() {
  fetch('/admin/kz', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var campo = document.getElementById('kzNumero');
      if (document.activeElement !== campo) campo.value = d.numero || '';
      var n = d.pendentes.length;
      kzNDep = n;
      kzTitulo();
      document.getElementById('kzBadge').textContent = n ? n + ' por confirmar' : '';
      var sig = JSON.stringify(d.pendentes.map(function (p) { return p.id; })) + JSON.stringify(kzAbertos);
      if (sig === kzSig) return;
      kzSig = sig;
      var el = document.getElementById('kzLista');
      if (!n) { el.innerHTML = '<div class="vazio">Nenhum depósito à espera.</div>'; return; }
      el.innerHTML = d.pendentes.map(function (p) {
        return '<div class="kz-item" data-id="' + p.id + '">' +
          '<div class="kz-topo"><b>' + esc(p.nome) + '</b><span class="kz-valor">' + p.valor + ' KZ</span><span class="n">' + fmtData(p.criado_em) + '</span></div>' +
          '<div class="kz-botoes">' +
          '<button type="button" data-acao="ver">' + (kzAbertos[p.id] ? 'Esconder comprovativo' : 'Ver comprovativo') + '</button>' +
          '<button type="button" class="ok" data-acao="ok">Confirmar</button>' +
          '<button type="button" class="no" data-acao="no">Rejeitar</button></div>' +
          (kzAbertos[p.id] ? '<img class="kz-foto" src="/admin/kz/foto/' + p.id + '" alt="Comprovativo">' : '') +
          '</div>';
      }).join('');
    })
    .catch(function () {});
}

document.getElementById('kzLista').addEventListener('click', function (e) {
  var acao = e.target.getAttribute && e.target.getAttribute('data-acao');
  if (!acao) return;
  var item = e.target.closest('.kz-item');
  var id = Number(item.getAttribute('data-id'));
  if (acao === 'ver') { kzAbertos[id] = !kzAbertos[id]; kzSig = ''; kzCarregar(); return; }
  var confirmar = acao === 'ok';
  var valor = item.querySelector('.kz-valor').textContent;
  var quem = item.querySelector('b').textContent;
  if (!window.confirm((confirmar ? 'Confirmar ' : 'Rejeitar ') + valor + ' de ' + quem + '? A foto será apagada.')) return;
  fetch('/admin/kz/decidir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id, confirmar: confirmar })
  }).then(function (r) { return r.json(); })
    .then(function (d) { if (d.erro) window.alert(d.erro); delete kzAbertos[id]; kzSig = ''; kzCarregar(); })
    .catch(function () { window.alert('Sem ligação ao servidor.'); });
});

document.getElementById('kzNumeroBtn').addEventListener('click', function () {
  var msg = document.getElementById('kzMsg');
  fetch('/admin/kz/numero', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: document.getElementById('kzNumero').value })
  }).then(function (r) { return r.json(); })
    .then(function (d) {
      msg.textContent = d.erro || 'Guardado ✓';
      setTimeout(function () { msg.textContent = ''; }, 2000);
    })
    .catch(function () { msg.textContent = 'Sem ligação.'; });
});

carregar();
kzCarregar();
setInterval(carregar, 10000);
setInterval(kzCarregar, 10000);

var levSig = '';

function levCarregar() {
  fetch('/admin/kz/levantamentos', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var n = d.pendentes.length;
      kzNLev = n;
      kzTitulo();
      document.getElementById('levBadge').textContent = n ? n + ' por pagar' : '';
      var sig = JSON.stringify(d.pendentes.map(function (p) { return p.id; }));
      if (sig === levSig) return;
      levSig = sig;
      var el = document.getElementById('levLista');
      if (!n) { el.innerHTML = '<div class="vazio">Nenhum levantamento à espera.</div>'; return; }
      el.innerHTML = d.pendentes.map(function (p) {
        return '<div class="kz-item" data-id="' + p.id + '">' +
          '<div class="kz-topo"><b>' + esc(p.nome) + '</b><span class="kz-valor">' + p.valor + ' KZ</span><span class="n">' + fmtData(p.criado_em) + '</span></div>' +
          '<div class="n">Enviar para: <b>' + esc(p.destino) + '</b></div>' +
          '<div class="kz-botoes">' +
          '<button type="button" class="ok" data-acao="pago">Marcar como pago</button>' +
          '<button type="button" class="no" data-acao="no">Rejeitar</button></div></div>';
      }).join('');
    })
    .catch(function () {});
}

document.getElementById('levLista').addEventListener('click', function (e) {
  var acao = e.target.getAttribute && e.target.getAttribute('data-acao');
  if (!acao) return;
  var item = e.target.closest('.kz-item');
  var id = Number(item.getAttribute('data-id'));
  var pago = acao === 'pago';
  var valor = item.querySelector('.kz-valor').textContent;
  var quem = item.querySelector('b').textContent;
  var texto = pago
    ? 'Confirmas que JÁ enviaste ' + valor + ' a ' + quem + '?'
    : 'Rejeitar o levantamento de ' + valor + ' de ' + quem + '? O saldo volta para ele.';
  if (!window.confirm(texto)) return;
  fetch('/admin/kz/levantamento/decidir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id, pago: pago })
  }).then(function (r) { return r.json(); })
    .then(function (d) { if (d.erro) window.alert(d.erro); levSig = ''; levCarregar(); })
    .catch(function () { window.alert('Sem ligação ao servidor.'); });
});

levCarregar();
setInterval(levCarregar, 10000);

function kzFmt(n) { return Number(n).toLocaleString('pt-PT') + ' KZ'; }

function resumoCarregar() {
  fetch('/admin/kz/resumo', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      document.getElementById('kzResumo').innerHTML =
        '<div><b>' + kzFmt(d.casa) + '</b><span>Conta geral (ganhos da casa)</span></div>' +
        '<div><b>' + kzFmt(d.jogadores) + '</b><span>Saldo dos jogadores</span></div>' +
        '<div><b>' + kzFmt(d.depositado) + '</b><span>Total depositado</span></div>' +
        '<div><b>' + kzFmt(d.levantado) + '</b><span>Total levantado (pago)</span></div>' +
        '<div><b>' + kzFmt(d.porPagar) + '</b><span>Por pagar</span></div>';
      var caixa = d.depositado - d.levantado;
      var soma = d.casa + d.jogadores + d.porPagar;
      document.getElementById('kzConfere').textContent =
        'Dinheiro real em caixa (esperado): ' + kzFmt(caixa) +
        (caixa === soma ? ' · contas certas ✓' : ' · atenção: não bate certo com os saldos (diferença de ' + kzFmt(caixa - soma) + ')');
    })
    .catch(function () {});
}
resumoCarregar();
setInterval(resumoCarregar, 10000);
</script>
</body>
</html>`;
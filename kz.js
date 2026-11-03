// Dinheiro real (KZ): rotas do jogador.
// Uso no server.js:  require('./kz')(app);

const express = require('express');
const contas = require('./contas');

const json = express.json({ limit: '10kb' });
const raw = express.raw({ type: 'image/jpeg', limit: '2mb' });

// Foto grande demais ou pedido estragado: responde em JSON em vez de uma página de erro
function foto(req, res, next) {
  raw(req, res, err => {
    if (!err) return next();
    res.status(err.status || 400).json({
      erro: err.type === 'entity.too.large' ? 'A foto é demasiado grande.' : 'Pedido inválido.'
    });
  });
}

// Só aceita JPEG de verdade (o admin mostra o ficheiro como imagem)
const ehJpeg = b => Buffer.isBuffer(b) && b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;

module.exports = function (app) {
  // Número para depositar, saldo KZ e mínimos
  app.post('/kz/info', json, async (req, res) => {
    const b = req.body || {};
    const c = await contas.validar(b.id, b.token);
    if (!c) return res.status(401).json({ erro: 'Sessão inválida.' });
    res.set('Cache-Control', 'no-store');
    res.json({
      numero: await contas.numeroDeposito(),
      saldoKz: c.saldoKz,
      depositoMin: contas.DEP_MIN,
      levantamentoMin: contas.LEV_MIN
    });
  });

  // Depósito: o corpo é a foto JPEG; a sessão e o valor vão nos cabeçalhos
  app.post('/kz/depositar', foto, async (req, res) => {
    const c = await contas.validar(req.get('x-conta-id'), req.get('x-conta-token'));
    if (!c) return res.status(401).json({ erro: 'Sessão inválida.' });
    if (!ehJpeg(req.body)) return res.status(400).json({ erro: 'Envia a foto do comprovativo.' });
    const r = await contas.pedirDeposito({ id: c.id, nome: c.nome }, req.get('x-valor'), req.body);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    res.json({ ok: true, valor: r.valor });
  });

  // Levantamento: o saldo fica retido logo e o pedido vai para a fila do admin
  app.post('/kz/levantar', json, async (req, res) => {
    const b = req.body || {};
    const c = await contas.validar(b.id, b.token);
    if (!c) return res.status(401).json({ erro: 'Sessão inválida.' });
    const r = await contas.pedirLevantamento({ id: c.id, nome: c.nome }, b.valor, b.destino);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    res.json({ ok: true, valor: r.valor, saldoKz: r.saldoKz });
  });
};
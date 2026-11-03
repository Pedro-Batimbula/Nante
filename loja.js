// Loja do Nante: catálogo e rotas (ver, comprar, equipar).
// Uso no server.js:  require('./loja')(app);
//
// O catálogo vive AQUI, no servidor: preços e moedas nunca vêm do cliente.
// Para mudar um preço, edita e faz push. moeda: 'N' (moedas do jogo) ou 'KZ' (dinheiro real).
// tipo: 'dado' | 'peca' | 'tabuleiro'. O campo "visual" diz ao ecrã como desenhar o item.
// (Preços de exemplo: ajusta à vontade.)

const express = require('express');
const contas = require('./contas');

const json = express.json({ limit: '10kb' });

const CATALOGO = [
  // ----- Dados (simples: poucas moedas N) -----
  { id: 'dado-vermelho', tipo: 'dado', nome: 'Dado vermelho', descricao: 'Pontos brancos em fundo vermelho.', preco: 100, moeda: 'N', visual: { cor: '#e53935' } },
  { id: 'dado-verde', tipo: 'dado', nome: 'Dado verde', descricao: 'Pontos brancos em fundo verde.', preco: 100, moeda: 'N', visual: { cor: '#2e9e5b' } },
  { id: 'dado-roxo', tipo: 'dado', nome: 'Dado roxo', descricao: 'Pontos brancos em fundo roxo.', preco: 150, moeda: 'N', visual: { cor: '#8420be' } },
  { id: 'dado-ouro', tipo: 'dado', nome: 'Dado de ouro', descricao: 'Dado dourado exclusivo.', preco: 500, moeda: 'KZ', visual: { cor: '#d4a017' } },

  // ----- Peças -----
  { id: 'peca-brilho', tipo: 'peca', nome: 'Peças com brilho', descricao: 'As tuas peças ganham um brilho suave.', preco: 400, moeda: 'N', visual: { estilo: 'brilho' } },
  { id: 'peca-cristal', tipo: 'peca', nome: 'Peças de cristal', descricao: 'Peças translúcidas, tipo cristal.', preco: 1500, moeda: 'N', visual: { estilo: 'cristal' } },
  { id: 'peca-ouro', tipo: 'peca', nome: 'Peças douradas', descricao: 'Peças de ouro exclusivas.', preco: 800, moeda: 'KZ', visual: { estilo: 'ouro' } },

  // ----- Estágios / tabuleiros (complexos: mais moedas N) -----
  { id: 'tabuleiro-noite', tipo: 'tabuleiro', nome: 'Estágio Noite', descricao: 'Tabuleiro escuro com estrelas.', preco: 2000, moeda: 'N', visual: { tema: 'noite' } },
  { id: 'tabuleiro-neve', tipo: 'tabuleiro', nome: 'Estágio Neve', descricao: 'Tabuleiro gelado com neve a cair.', preco: 2500, moeda: 'N', visual: { tema: 'neve' } },
  { id: 'tabuleiro-vulcao', tipo: 'tabuleiro', nome: 'Estágio Vulcão', descricao: 'Tabuleiro dinâmico com lava e faíscas.', preco: 1500, moeda: 'KZ', visual: { tema: 'vulcao', dinamico: true } }
];

const porId = new Map(CATALOGO.map(i => [i.id, i]));

module.exports = function (app) {
  // Catálogo + o que o jogador já tem + saldos
  app.post('/loja/lista', json, async (req, res) => {
    const b = req.body || {};
    const c = await contas.validar(b.id, b.token);
    if (!c) return res.status(401).json({ erro: 'Sessão inválida.' });
    const meus = new Map((await contas.inventario(c.id)).map(m => [m.item_id, m]));
    res.set('Cache-Control', 'no-store');
    res.json({
      moedas: c.moedas,
      saldoKz: c.saldoKz,
      itens: CATALOGO.map(i => {
        const m = meus.get(i.id);
        return { ...i, tem: !!m, equipado: !!(m && m.equipado) };
      })
    });
  });

  app.post('/loja/comprar', json, async (req, res) => {
    const b = req.body || {};
    const c = await contas.validar(b.id, b.token);
    if (!c) return res.status(401).json({ erro: 'Sessão inválida.' });
    const item = porId.get(String(b.itemId));
    if (!item) return res.status(404).json({ erro: 'Esse item não existe.' });
    const r = await contas.comprarItem(c.id, item);
    res.status(r.erro ? 400 : 200).json(r);
  });

  app.post('/loja/equipar', json, async (req, res) => {
    const b = req.body || {};
    const c = await contas.validar(b.id, b.token);
    if (!c) return res.status(401).json({ erro: 'Sessão inválida.' });
    if (!porId.has(String(b.itemId))) return res.status(404).json({ erro: 'Esse item não existe.' });
    const r = await contas.equiparItem(c.id, b.itemId, b.equipar !== false);
    res.status(r.erro ? 400 : 200).json(r);
  });
};

module.exports.CATALOGO = CATALOGO;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { criarEstadoInicial, jogadoresAtivosIndices, jogadorAtivoIndice, jogadorDaPeca, rolarDados, moverPeca, marcarAbandono } = require('./regras');
const historico = require('./historico');   // HISTÓRICO
const crypto = require('crypto');
const contas = require('./contas');         // CONTAS
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
require('./admin')(app);   // ADMIN

// CONTAS: criar conta (só nome) e validar a sessão guardada no aparelho
app.use(express.json());
app.post('/conta/criar', async (req, res) => {
  const r = await contas.criar(req.body && req.body.nome, req.body && req.body.senha);
  if (!r.erro && req.body && req.body.convite) {
    const b = await contas.amizadePorLink(r.id, req.body.convite);
    if (b) {
      const sala = 'conta-' + b.anfitriao.id;
      if (b.moedas !== undefined) io.to(sala).emit('moedas:saldo', { moedas: b.moedas, delta: b.premio, motivo: 'convite_amigo' });
      io.to(sala).emit('amigos:aviso', { texto: r.nome + ' entrou pelo teu link e já é teu amigo!' });
      sincronizarAmizade(b.anfitriao.id, r.id);
    }
  }
  res.status(r.erro ? 400 : 200).json(r);
});
app.post('/conta/validar', async (req, res) => {
  const c = await contas.validar(req.body && req.body.id, req.body && req.body.token);
  if (!c) return res.status(401).json({ erro: 'Sessão inválida.' });
  res.json(c);
});
app.post('/conta/senha', async (req, res) => {
  const b = req.body || {};
  const r = await contas.definirSenha(b.id, b.token, b.senha);
  res.status(r.erro ? (r.status || 400) : 200).json(r);
});
app.post('/conta/entrar', async (req, res) => {
  const b = req.body || {};
  const r = await contas.entrar(b.nome, b.senha);
  res.status(r.erro ? 400 : 200).json(r);
});

// ===== Estado do lobby e das salas =====
// Cada sala: { id, jogadores: [ {socketId, nome, indice} ], totalPlayers, totalPecas, iniciado }
const salas = {};
let proximoIdSala = 1;

const MAX_JOGADORES_POR_SALA = 4;

function criarSala(totalPlayers, totalPecas) {
  const id = 'sala-' + (proximoIdSala++);
  salas[id] = {
    id,
    jogadores: [],
    totalPlayers,   // quantos jogadores esta sala espera (2, 3 ou 4)
    totalPecas,     // quantas peças por jogador (1 a 4)
    iniciado: false,
    // estadoDoJogo será preenchido aqui quando portarmos as regras
    estadoDoJogo: null
  };
  return salas[id];
}

// Procura uma sala compatível (mesmo nº de jogadores/peças) com vaga e ainda não iniciada.
// Se não encontrar, cria uma nova.
function encontrarOuCriarSala(totalPlayers, totalPecas) {
  const existente = Object.values(salas).find(s =>
    !s.privada &&
    !s.iniciado &&
    s.totalPlayers === totalPlayers &&
    s.totalPecas === totalPecas &&
    s.jogadores.length < s.totalPlayers
  );
  return existente || criarSala(totalPlayers, totalPecas);
}

function estadoPublicoDaSala(sala) {
  return {
    id: sala.id,
    jogadores: sala.jogadores.map(j => ({ nome: j.nome, indice: j.indice })),
    totalPlayers: sala.totalPlayers,
    totalPecas: sala.totalPecas,
    iniciado: sala.iniciado,
    privada: !!sala.privada,
    codigo: sala.privada ? sala.codigo : null,
    donoId: sala.privada ? sala.donoId : null,
    aposta: sala.aposta || 0,
    confirmando: !!sala.confirmando
  };
}

// Lista de todas as salas ainda em espera (não iniciadas, com vaga) - para o lobby mostrar
// ao jogador antes de ele escolher onde entrar.
function listaDeSalasEmEspera() {
  return Object.values(salas)
    .filter(s => !s.privada && !s.iniciado && s.jogadores.length < s.totalPlayers)
    .map(estadoPublicoDaSala);
}

function avisarTodosDaListaDeSalas() {
  io.emit('lobby:salas', listaDeSalasEmEspera());
  avisarDonos();   // MESAS PRIVADAS
}

// ===== Mesas privadas =====
const LETRAS_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sem 0/O/1/I/L, que se confundem
function gerarCodigo() {
  let c;
  do {
    c = Array.from({ length: 5 }, () => LETRAS_CODIGO[crypto.randomInt(LETRAS_CODIGO.length)]).join('');
  } while (Object.values(salas).some(s => s.codigo === c));
  return c;
}

function listaDoDono(donoId) {
  return Object.values(salas)
    .filter(s => s.privada && s.donoId === donoId)
    .map(s => {
      const dentro = s.jogadores.filter(j => !j.desconectado);
      return {
        id: s.id, codigo: s.codigo, totalPlayers: s.totalPlayers, totalPecas: s.totalPecas,
        entraram: dentro.length, nomes: dentro.map(j => j.nome), iniciado: s.iniciado,
        donoSentado: dentro.some(j => j.contaId === donoId), confirmando: !!s.confirmando,
        aposta: s.aposta || 0
      };
    });
}

// Envia a cada dono de mesas a sua lista atualizada
function avisarDonos() {
  const donos = new Set(Object.values(salas).filter(s => s.privada).map(s => s.donoId));
  io.sockets.sockets.forEach(s => {
    if (donos.has(s.data.contaId)) s.emit('privada:minhas', listaDoDono(s.data.contaId));
  });
}

// Chamado quando um socket desliga. Se o jogo dessa sala já tinha começado e ainda não
// terminou, o jogador é marcado como "abandonou" (não conta como vitória nem derrota) em vez
// de ser simplesmente removido - isso preserva os índices e a ocupação das peças no tabuleiro.
// Se a sala ainda estava no lobby (jogo não iniciado), o jogador é removido normalmente.
// Em qualquer caso, se TODOS os jogadores da sala já saíram, a sala é eliminada.
function removerJogadorDeTodasAsSalas(socketId) {
  Object.values(salas).forEach(sala => {
    const jogadorDoSocket = sala.jogadores.find(j => j.socketId === socketId);
    if (!jogadorDoSocket) return;

    if (sala.iniciado && sala.estadoDoJogo && !sala.estadoDoJogo.jogoTerminado) {
      jogadorDoSocket.desconectado = true;
      marcarAbandono(sala.estadoDoJogo, jogadorDoSocket.indice);
      io.to(sala.id).emit('estadoAtualizado', sala.estadoDoJogo);

      if (sala.estadoDoJogo.jogoTerminado) {
        iniciarFaseDeDecisao(sala);
      }
    } else {
      sala.jogadores = sala.jogadores.filter(j => j.socketId !== socketId);
      io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
    }

    const todosSairam = sala.jogadores.every(j => j.desconectado) || sala.jogadores.length === 0;
    const mesaPrivadaAEspera = sala.privada && !sala.iniciado;   // fica viva, mesmo vazia
    if (todosSairam && !mesaPrivadaAEspera) {
      // HISTÓRICO: se a sala acabou com o jogo a meio, fica registado como abandonado
      if (sala.estadoDoJogo && !sala.estadoDoJogo.jogoTerminado) {
        historico.registarFim(sala.jogoId, sala.estadoDoJogo, 'abandonado');
      }
      delete salas[sala.id];
    }
    avisarTodosDaListaDeSalas();
  });
}

// Emite os resultados finais e coloca a sala em modo de decisão: cada jogador escolhe
// "continuar" (recomeçar com os mesmos jogadores) ou "sair".
function iniciarFaseDeDecisao(sala) {
  historico.registarFim(sala.jogoId, sala.estadoDoJogo);   // HISTÓRICO
  // ESTATÍSTICAS: +1 jogo a cada jogador (quem abandonou não conta) e +1 vitória ao 1.º lugar
  sala.jogadores.forEach(j => {
    const est = sala.estadoDoJogo.jogadores[j.indice];
    if (j.contaId && est && !est.abandonou) contas.registarResultado(j.contaId, est.classificacao === 1);
  });
  pagarFimDeJogo(sala);   // APOSTAS e bónus de vitória
  sala.aguardandoDecisao = true;
  sala.decisoes = {};

  const classificacaoFinal = sala.jogadores
    .map(j => ({ nome: j.nome, indice: j.indice, classificacao: sala.estadoDoJogo.jogadores[j.indice].classificacao, abandonou: sala.estadoDoJogo.jogadores[j.indice].abandonou }))
    .sort((a, b) => (a.classificacao ?? 99) - (b.classificacao ?? 99));

  io.to(sala.id).emit('jogo:terminado', { classificacaoFinal });
}

// Quando todos os jogadores CONECTADOS já decidiram, resolve: quem quer continuar joga de
// novo (com estado novo); quem sai é removido da sala.
async function resolverDecisoesPosJogo(sala) {
  const conectados = sala.jogadores.filter(j => !j.desconectado);
  const todosDecidiram = conectados.every(j => sala.decisoes[j.socketId] !== undefined);
  if (!todosDecidiram) return;

  const querContinuar = j => sala.decisoes[j.socketId] === 'continuar' && !j.desconectado;

  sala.jogadores = sala.jogadores.filter(querContinuar);
  sala.aguardandoDecisao = false;
  sala.decisoes = {};

  if (sala.jogadores.length === 0) {
    delete salas[sala.id];
    avisarTodosDaListaDeSalas();
    return;
  }

  // Reatribui índices reais (0-3) sequencialmente aos que ficaram, e avisa cada um do seu novo índice
  const indicesDisponiveis = jogadoresAtivosIndices(sala.totalPlayers);
  sala.jogadores.forEach((j, posicao) => {
    j.indice = indicesDisponiveis[posicao];
    io.to(j.socketId).emit('lobby:voce', { indice: j.indice, nome: j.nome });
  });

  if (sala.jogadores.length === sala.totalPlayers && sala.aposta > 0) {
    sala.iniciado = true;   // fecha a mesa a novas entradas enquanto se cobra
    if (!(await cobrarApostas(sala))) {
      sala.iniciado = false;
      sala.estadoDoJogo = null;
      io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
      avisarTodosDaListaDeSalas();
      return;
    }
  }
  if (sala.jogadores.length === sala.totalPlayers) {
    sala.iniciado = true;
    sala.estadoDoJogo = criarEstadoInicial(sala.totalPlayers, sala.totalPecas);
    sala.jogoId = historico.registarInicio(sala);   // HISTÓRICO
    io.to(sala.id).emit('jogo:iniciar', estadoPublicoDaSala(sala));
    io.to(sala.id).emit('estadoAtualizado', sala.estadoDoJogo);
  } else {
    sala.iniciado = false;
    sala.estadoDoJogo = null;
    io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
  }
  avisarTodosDaListaDeSalas();
}

// ===== Mesa privada: o criador manda começar e os presentes confirmam =====
const SEGUNDOS_CONFIRMAR = 20;

function tirarDaMesa(sala, jogador) {
  sala.jogadores = sala.jogadores.filter(x => x !== jogador);
  const s = io.sockets.sockets.get(jogador.socketId);
  if (s) {
    s.leave(sala.id);
    s.data.salaId = null;
    s.emit('lobby:saiu');
  }
}

function reatribuirIndices(sala) {
  const indices = jogadoresAtivosIndices(sala.totalPlayers);
  sala.jogadores.forEach((j, pos) => {
    j.indice = indices[pos];
    io.to(j.socketId).emit('lobby:voce', { indice: j.indice, nome: j.nome });
  });
}

async function resolverConfirmacao(sala) {
  if (salas[sala.id] !== sala || !sala.confirmando) return;
  clearTimeout(sala.timerConfirmacao);
  sala.confirmando = false;

  // quem não confirmou a tempo sai da mesa
  sala.jogadores
    .filter(j => sala.respostas[j.socketId] !== 'participar')
    .forEach(j => tirarDaMesa(sala, j));

  const donoFicou = sala.jogadores.some(j => j.contaId === sala.donoId);
  if (!donoFicou || sala.jogadores.length < 2) {
    reatribuirIndices(sala);
    io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
    io.to(sala.id).emit('privada:cancelado', { motivo: 'Jogadores insuficientes: são precisos pelo menos 2. A mesa continua à espera.' });
    avisarTodosDaListaDeSalas();
    return;
  }

  // joga-se com quem confirmou
  if (sala.aposta > 0) {
    sala.iniciado = true;   // fecha a mesa a novas entradas enquanto se cobra
    if (!(await cobrarApostas(sala))) {
      sala.iniciado = false;
      reatribuirIndices(sala);
      io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
      avisarTodosDaListaDeSalas();
      return;
    }
  }
  sala.totalPlayers = sala.jogadores.length;
  reatribuirIndices(sala);
  sala.iniciado = true;
  sala.estadoDoJogo = criarEstadoInicial(sala.totalPlayers, sala.totalPecas);
  sala.jogoId = historico.registarInicio(sala);   // HISTÓRICO
  io.to(sala.id).emit('jogo:iniciar', estadoPublicoDaSala(sala));
  io.to(sala.id).emit('estadoAtualizado', sala.estadoDoJogo);
  avisarTodosDaListaDeSalas();
}

// ===== Matadas: +100 moedas por peça capturada =====
const PREMIO_MATADA = 100, MAX_MATADAS_PAGAS = 10;   // limite por jogador em cada jogo
function pagarMatadas(sala) {
  const est = sala.estadoDoJogo;
  if (!est || !est.matadas || !est.matadas.length) return;
  const lista = est.matadas.splice(0);   // esvazia antes de o estado seguir para os clientes
  if (sala.matadasEstado !== est) { sala.matadasEstado = est; sala.matadasPagas = {}; }
  lista.forEach(m => {
    const j = sala.jogadores.find(x => x.indice === m.matador);
    if (!j || !j.contaId) return;
    const feitas = sala.matadasPagas[j.contaId] || 0;
    if (feitas >= MAX_MATADAS_PAGAS) return;
    sala.matadasPagas[j.contaId] = feitas + 1;
    io.to(sala.id).emit('jogo:matada', { casa: m.casa, matador: m.matador, vitima: m.vitima, valor: PREMIO_MATADA });
    contas.mexerMoedas(j.contaId, PREMIO_MATADA, 'matada').then(r => {
      if (r.moedas !== undefined) io.to(j.socketId).emit('moedas:saldo', { moedas: r.moedas, delta: PREMIO_MATADA, motivo: 'matada' });
    });
  });
}

// ===== Amigos: presença online, listas e avisos =====
const amigosDe = new Map();       // conta -> ids dos amigos (só de quem está online)
const ultimoEstado = new Map();   // conta -> último estado avisado aos amigos

// 'offline' | 'online' (livre) | 'mesa' (à espera numa mesa) | 'jogo'
function estadoDeConta(id) {
  const r = io.sockets.adapter.rooms.get('conta-' + id);
  if (!r || !r.size) return 'offline';
  const s = Object.values(salas).find(x => x.jogadores.some(j => j.contaId === id && !j.desconectado));
  return s ? (s.iniciado ? 'jogo' : 'mesa') : 'online';
}
async function carregarAmigos(id) {
  amigosDe.set(id, new Set(await contas.idsDosAmigos(id)));
}
function avisarPresenca(id) {
  const estado = estadoDeConta(id);
  ultimoEstado.set(id, estado);
  (amigosDe.get(id) || []).forEach(a => io.to('conta-' + a).emit('amigos:presenca', { id, estado }));
}
async function enviarLista(id) {
  if (estadoDeConta(id) === 'offline') return;
  const l = await contas.listarAmigos(id);
  l.amigos.forEach(a => { a.estado = estadoDeConta(a.id); });
  io.to('conta-' + id).emit('amigos:lista', l);
}
// Depois de uma mudança entre dois jogadores: atualiza as listas dos dois
async function sincronizarAmizade(a, b) {
  for (const id of [a, b]) {
    if (amigosDe.has(id)) await carregarAmigos(id);
    enviarLista(id);
    avisarPresenca(id);
  }
}
async function contaDe(socket, dados) {
  const c = await contas.validar(dados && dados.id, dados && dados.token);
  if (!c) { socket.emit('conta:invalida'); return null; }
  return c;
}
// A cada 3 s vê quem mudou de estado (entrou numa mesa, começou a jogar, saiu...) e avisa os amigos
setInterval(() => {
  for (const id of [...amigosDe.keys()]) {
    const e = estadoDeConta(id);
    if (e !== ultimoEstado.get(id)) avisarPresenca(id);
    if (e === 'offline') { amigosDe.delete(id); ultimoEstado.delete(id); }
  }
}, 3000);

// ===== Apostas e prémios =====
const APOSTA_MIN = 10, APOSTA_MAX = 10000, BONUS_VITORIA = 200;

// Cobra a entrada a todos. Se alguém não tiver moedas, devolve o que já cobrou,
// tira essa pessoa da mesa e devolve false.
async function cobrarApostas(sala) {
  const cobrados = [];
  for (const j of sala.jogadores) {
    const r = await contas.mexerMoedas(j.contaId, -sala.aposta, 'aposta_entrada');
    if (r.erro) {
      for (const c of cobrados) {
        const d = await contas.mexerMoedas(c.contaId, sala.aposta, 'aposta_devolvida');
        if (d.moedas !== undefined) io.to(c.socketId).emit('moedas:saldo', { moedas: d.moedas, delta: sala.aposta, motivo: 'aposta_devolvida' });
      }
      const s = io.sockets.sockets.get(j.socketId);
      if (s) s.emit('jogo:erro', 'Não tens moedas suficientes para a aposta (' + sala.aposta + ').');
      tirarDaMesa(sala, j);
      io.to(sala.id).emit('privada:cancelado', { motivo: j.nome + ' não tinha moedas para a aposta e saiu da mesa.' });
      return false;
    }
    io.to(j.socketId).emit('moedas:saldo', { moedas: r.moedas, delta: -sala.aposta, motivo: 'aposta_entrada' });
    cobrados.push(j);
  }
  return true;
}

// Fim de jogo:
//  - 2 jogadores: o 1.º leva tudo o que foi apostado.
//  - 3 ou 4: o 2.º recupera a sua entrada; o 1.º leva a sua entrada + as dos restantes.
//  - Vitória: +200 (só se pelo menos um adversário não abandonou).
async function pagarFimDeJogo(sala) {
  if (sala.estadoPago === sala.estadoDoJogo) return;   // paga uma só vez por jogo
  sala.estadoPago = sala.estadoDoJogo;
  const est = sala.estadoDoJogo;
  const n = sala.jogadores.length;
  const lista = sala.jogadores.map(j => {
    const e = est.jogadores[j.indice];
    return { j, classificacao: e.classificacao, abandonou: !!e.abandonou };
  });
  const primeiro = lista.find(p => p.classificacao === 1);
  if (!primeiro) return;
  const segundo = lista.find(p => p.classificacao === 2);
  const aposta = sala.aposta || 0;
  const premios = [];
  if (aposta > 0) {
    const devolve = n >= 3 && !!segundo;
    premios.push({ p: primeiro, valor: aposta * (devolve ? n - 1 : n), motivo: 'aposta_ganha' });
    if (devolve) premios.push({ p: segundo, valor: aposta, motivo: 'aposta_devolvida' });
  }
  if (lista.some(p => p !== primeiro && !p.abandonou)) {
    premios.push({ p: primeiro, valor: BONUS_VITORIA, motivo: 'vitoria' });
  }
  for (const pr of premios) {
    const r = await contas.mexerMoedas(pr.p.j.contaId, pr.valor, pr.motivo);
    if (r.moedas !== undefined) {
      io.to(pr.p.j.socketId).emit('moedas:saldo', { moedas: r.moedas, delta: pr.valor, motivo: pr.motivo });
    }
  }
  io.to(sala.id).emit('jogo:premios', premios.map(pr => ({ nome: pr.p.j.nome, valor: pr.valor, motivo: pr.motivo })));
}

io.on('connection', (socket) => {
  console.log('Ligado:', socket.id);

  // Junta um jogador a uma sala (nova ou existente) e trata do início do jogo se completar.
  function entrarNaSala(socket, sala, nome) {
    const indice = jogadoresAtivosIndices(sala.totalPlayers)[sala.jogadores.length];
    const nomeFinal = (nome || '').trim() || ('Jogador ' + (indice + 1));

    sala.jogadores.push({ socketId: socket.id, nome: nomeFinal, indice, contaId: socket.data.contaId });
    socket.join(sala.id);
    socket.data.salaId = sala.id;

    socket.emit('lobby:voce', { indice, nome: nomeFinal });
    io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
    avisarTodosDaListaDeSalas();

    // mesa privada: só começa quando o criador mandar
    if (!sala.privada && sala.jogadores.length === sala.totalPlayers) {
      sala.iniciado = true;
      sala.estadoDoJogo = criarEstadoInicial(sala.totalPlayers, sala.totalPecas);
      sala.jogoId = historico.registarInicio(sala);   // HISTÓRICO

      io.to(sala.id).emit('jogo:iniciar', estadoPublicoDaSala(sala));
      io.to(sala.id).emit('estadoAtualizado', sala.estadoDoJogo);
      avisarTodosDaListaDeSalas();
    }
  }

  // Cliente pede para entrar no lobby, com as preferências de nº de jogadores/peças.
  // Junta-se automaticamente a uma sala compatível existente, ou cria uma nova.
  socket.on('lobby:entrar', async ({ id, token, totalPlayers, totalPecas }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    socket.data.contaId = conta.id;
    const nome = conta.nome;
    const nJogadores = [2, 3, 4].includes(Number(totalPlayers)) ? Number(totalPlayers) : 4;
    const nPecas = [1, 2, 3, 4].includes(Number(totalPecas)) ? Number(totalPecas) : 4;

    const sala = encontrarOuCriarSala(nJogadores, nPecas);
    entrarNaSala(socket, sala, nome);
  });

  // Cliente pede a lista de salas em espera (para mostrar no lobby)
  socket.on('lobby:listarSalas', () => {
    socket.emit('lobby:salas', listaDeSalasEmEspera());
  });

  // Cliente escolhe diretamente uma sala já existente da lista
  socket.on('lobby:entrarNaSala', async ({ salaId, id, token }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    socket.data.contaId = conta.id;
    const nome = conta.nome;
    const sala = salas[salaId];
    if (!sala || sala.privada || sala.iniciado || sala.jogadores.length >= sala.totalPlayers) {
      socket.emit('jogo:erro', 'Essa sala já não está disponível.');
      socket.emit('lobby:salas', listaDeSalasEmEspera());
      return;
    }
    entrarNaSala(socket, sala, nome);
  });

  // ===== MESAS PRIVADAS =====
  // O dono pede a lista das suas mesas (e fica identificado para receber atualizações)
  socket.on('privada:listar', async ({ id, token }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    socket.data.contaId = conta.id;
    socket.emit('privada:minhas', listaDoDono(conta.id));
  });

  // Criar mesa: gera o código; o criador não ocupa lugar até entrar nela
  socket.on('privada:criar', async ({ id, token, totalPlayers, totalPecas, tipo, aposta }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    socket.data.contaId = conta.id;
    let valorAposta = 0;
    if (tipo === 'aposta') {
      valorAposta = Math.trunc(Number(aposta));
      if (!(valorAposta >= APOSTA_MIN && valorAposta <= APOSTA_MAX)) {
        socket.emit('jogo:erro', 'A aposta deve ser entre ' + APOSTA_MIN + ' e ' + APOSTA_MAX + ' moedas.'); return;
      }
      if (conta.moedas < valorAposta) { socket.emit('jogo:erro', 'Não tens moedas suficientes para esta aposta.'); return; }
    } else if (tipo && tipo !== 'normal') { return; }
    if (listaDoDono(conta.id).length >= 5) {
      socket.emit('jogo:erro', 'Já tens 5 mesas privadas. Apaga uma para criar outra.');
      return;
    }
    const nJogadores = [2, 3, 4].includes(Number(totalPlayers)) ? Number(totalPlayers) : 4;
    const nPecas = [1, 2, 3, 4].includes(Number(totalPecas)) ? Number(totalPecas) : 4;
    const sala = criarSala(nJogadores, nPecas);
    sala.privada = true;
    sala.codigo = gerarCodigo();
    sala.donoId = conta.id;
    sala.aposta = valorAposta;
    avisarTodosDaListaDeSalas();
    socket.emit('privada:criada', { codigo: sala.codigo, salaId: sala.id });
  });

  // Entrar numa mesa privada com o código
  socket.on('privada:entrar', async ({ id, token, codigo }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    socket.data.contaId = conta.id;
    const cod = String(codigo || '').trim().toUpperCase();
    const sala = Object.values(salas).find(s => s.privada && s.codigo === cod);
    if (!sala) { socket.emit('jogo:erro', 'Código inválido.'); return; }
    if (sala.iniciado) { socket.emit('jogo:erro', 'Essa mesa já começou.'); return; }
    if (sala.confirmando) { socket.emit('jogo:erro', 'O jogo está prestes a começar.'); return; }
    const reservado = sala.jogadores.some(j => j.contaId === sala.donoId) ? 0 : 1;   // lugar guardado para o criador
    const cheia = conta.id === sala.donoId
      ? sala.jogadores.length >= sala.totalPlayers
      : sala.jogadores.length >= sala.totalPlayers - reservado;
    if (cheia) { socket.emit('jogo:erro', 'Essa mesa já está cheia.'); return; }
    const jaSentado = Object.values(salas).some(s => s.jogadores.some(j =>
      !j.desconectado && (j.socketId === socket.id || (s.id === sala.id && j.contaId === conta.id))));
    if (jaSentado) { socket.emit('jogo:erro', 'Já estás numa sala.'); return; }
    if (sala.aposta > 0 && conta.moedas < sala.aposta) {
      socket.emit('jogo:erro', 'Esta mesa tem aposta de ' + sala.aposta + ' moedas e não tens o suficiente.'); return;
    }
    entrarNaSala(socket, sala, conta.nome);
  });

  // O dono apaga uma mesa que ainda não começou
  socket.on('privada:apagar', async ({ id, token, salaId }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    const sala = salas[salaId];
    if (!sala || !sala.privada || sala.donoId !== conta.id) return;
    if (sala.iniciado) { socket.emit('jogo:erro', 'Essa mesa já começou.'); return; }
    if (sala.confirmando) { socket.emit('jogo:erro', 'O jogo está prestes a começar.'); return; }
    io.to(sala.id).emit('privada:fechada');
    delete salas[sala.id];
    avisarTodosDaListaDeSalas();
    socket.emit('privada:minhas', listaDoDono(conta.id));
  });

  // O criador manda começar: ele próprio entra e os presentes têm 20 s para confirmar
  socket.on('privada:comecar', async ({ id, token, salaId }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    socket.data.contaId = conta.id;
    const sala = salas[salaId];
    if (!sala || !sala.privada || sala.donoId !== conta.id) return;
    if (sala.iniciado) { socket.emit('jogo:erro', 'Essa mesa já começou.'); return; }
    if (sala.confirmando) return;
    if (sala.jogadores.filter(j => j.contaId !== conta.id).length < 1) {
      socket.emit('jogo:erro', 'Ainda ninguém entrou na mesa. São precisos pelo menos 2 jogadores.');
      return;
    }
    const eu = sala.jogadores.find(j => j.contaId === conta.id);
    if (eu && eu.socketId !== socket.id) { socket.emit('jogo:erro', 'Já estás nesta mesa noutro separador.'); return; }
    if (!eu) {
      const jaNoutra = Object.values(salas).some(s => s.jogadores.some(j => !j.desconectado && j.socketId === socket.id));
      if (jaNoutra) { socket.emit('jogo:erro', 'Já estás numa sala.'); return; }
      if (sala.jogadores.length >= sala.totalPlayers) { socket.emit('jogo:erro', 'Essa mesa já está cheia.'); return; }
      if (sala.aposta > 0 && conta.moedas < sala.aposta) { socket.emit('jogo:erro', 'Não tens moedas suficientes para a aposta (' + sala.aposta + ').'); return; }
      entrarNaSala(socket, sala, conta.nome);   // o criador entra no próprio jogo
    }
    sala.confirmando = true;
    sala.respostas = { [socket.id]: 'participar' };
    socket.to(sala.id).emit('privada:prestes', { segundos: SEGUNDOS_CONFIRMAR });
    socket.emit('privada:aguardando', { segundos: SEGUNDOS_CONFIRMAR });
    sala.timerConfirmacao = setTimeout(() => resolverConfirmacao(sala), SEGUNDOS_CONFIRMAR * 1000);
    io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
    avisarTodosDaListaDeSalas();
  });

  // Resposta de quem recebeu "jogo prestes a começar": participar ou sair
  socket.on('privada:resposta', ({ resposta }) => {
    const sala = salas[socket.data.salaId];
    if (!sala || !sala.confirmando) return;
    const eu = sala.jogadores.find(j => j.socketId === socket.id);
    if (!eu) return;
    if (resposta === 'participar') {
      sala.respostas[socket.id] = 'participar';
    } else {
      tirarDaMesa(sala, eu);   // sai; o jogo continua sem ele
      io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
      avisarTodosDaListaDeSalas();
    }
    // todos os que ficaram já confirmaram: não é preciso esperar pelos 20 s
    if (sala.jogadores.every(j => sala.respostas[j.socketId] === 'participar')) resolverConfirmacao(sala);
  });

  // ===== AMIGOS =====
  socket.on('amigos:ligar', async (d) => {
    const conta = await contaDe(socket, d);
    if (!conta) return;
    socket.data.contaId = conta.id;
    socket.join('conta-' + conta.id);
    await carregarAmigos(conta.id);
    avisarPresenca(conta.id);
    enviarLista(conta.id);
  });
  socket.on('amigos:procurar', async (d) => {
    const conta = await contaDe(socket, d);
    if (!conta) return;
    const r = await contas.procurarJogadores(conta.id, d.termo);
    if (r.erro) { socket.emit('amigos:aviso', { erro: true, texto: r.erro }); return; }
    socket.emit('amigos:resultados', { termo: String(d.termo || ''), lista: r.lista });
  });
  socket.on('amigos:listar', async (d) => {
    const conta = await contaDe(socket, d);
    if (conta) enviarLista(conta.id);
  });
  socket.on('amigos:pedir', async (d) => {
    const conta = await contaDe(socket, d);
    if (!conta) return;
    const r = await contas.pedirAmizade(conta.id, d.nome);
    if (r.erro) { socket.emit('amigos:aviso', { erro: true, texto: r.erro }); return; }
    socket.emit('amigos:aviso', { texto: r.aceite ? 'Agora és amigo de ' + r.alvo.nome + '!' : 'Pedido enviado a ' + r.alvo.nome + '.' });
    io.to('conta-' + r.alvo.id).emit('amigos:aviso', { texto: r.aceite ? conta.nome + ' aceitou ser teu amigo!' : conta.nome + ' quer ser teu amigo.' });
    await sincronizarAmizade(conta.id, r.alvo.id);
  });
  socket.on('amigos:responder', async (d) => {
    const conta = await contaDe(socket, d);
    if (!conta) return;
    const r = await contas.responderPedido(conta.id, d.pedidoId, !!d.aceitar);
    if (r.erro) { socket.emit('amigos:aviso', { erro: true, texto: r.erro }); enviarLista(conta.id); return; }
    if (r.aceite) io.to('conta-' + r.outro.id).emit('amigos:aviso', { texto: conta.nome + ' aceitou o teu pedido!' });
    await sincronizarAmizade(conta.id, r.outro.id);
  });
  // serve para remover um amigo e para cancelar um pedido que enviei
  socket.on('amigos:remover', async (d) => {
    const conta = await contaDe(socket, d);
    if (!conta) return;
    const r = await contas.removerAmizade(conta.id, d.outroId);
    if (r.erro) { socket.emit('amigos:aviso', { erro: true, texto: r.erro }); return; }
    await sincronizarAmizade(conta.id, Number(d.outroId));
  });
  // Convidar um amigo online e livre para a minha mesa privada (o convite vale 60 s)
  socket.on('amigos:convidar', async (d) => {
    const conta = await contaDe(socket, d);
    if (!conta) return;
    const falha = t => socket.emit('amigos:aviso', { erro: true, texto: t });
    const amigoId = Number(d.amigoId);
    const sala = salas[d.salaId];
    if (!sala || !sala.privada || !sala.jogadores.some(j => j.contaId === conta.id && !j.desconectado)) {
      return falha('Só podes convidar para uma mesa privada em que estás.');
    }
    if (sala.iniciado || sala.confirmando) return falha('A mesa já está a começar.');
    if (sala.jogadores.length >= sala.totalPlayers) return falha('A mesa já está cheia.');
    const meus = await contas.idsDosAmigos(conta.id);
    if (!meus.includes(amigoId)) return falha('Essa pessoa não é tua amiga.');
    const estado = estadoDeConta(amigoId);
    if (estado === 'offline') return falha('O teu amigo não está online.');
    if (estado !== 'online') return falha('O teu amigo já está numa mesa ou em jogo.');
    sala.convites = sala.convites || {};
    if (Date.now() - (sala.convites[amigoId] || 0) < 60000) return falha('Já o convidaste há pouco. Espera um minuto.');
    sala.convites[amigoId] = Date.now();
    io.to('conta-' + amigoId).emit('amigos:convite', {
      de: conta.nome, codigo: sala.codigo, aposta: sala.aposta || 0, totalPlayers: sala.totalPlayers, segundos: 60
    });
    socket.emit('amigos:aviso', { texto: 'Convite enviado.' });
  });

  // PERFIL: o cliente pede as suas moedas e estatísticas
  socket.on('perfil:pedir', async ({ id, token }) => {
    const conta = await contas.validar(id, token);
    if (!conta) { socket.emit('conta:invalida'); return; }
    socket.emit('perfil:dados', {
      nome: conta.nome,
      moedas: conta.moedas,
      vitorias: conta.vitorias,
      jogos: conta.jogos,
      derrotas: Math.max(0, conta.jogos - conta.vitorias),
      percentagem: conta.jogos ? Math.round(conta.vitorias * 100 / conta.jogos) : 0
    });
  });
  // Sair de uma sala que ainda não começou (volta ao início)
  socket.on('lobby:sair', () => {
    const sala = salas[socket.data.salaId];
    if (!sala || sala.iniciado) return;
    removerJogadorDeTodasAsSalas(socket.id);
    socket.leave(sala.id);
    socket.data.salaId = null;
    socket.emit('lobby:saiu');
  });

  // Chat ao vivo: só reencaminha para a sala, não guarda nada
  socket.on('chat:enviar', ({ texto, nome } = {}) => {
    const sala = salas[socket.data.salaId];
    if (!sala || !sala.iniciado) return;
    const t = String(texto || '').trim().slice(0, 80);
    if (!t) return;
    const agora = Date.now();
    if (agora - (socket.ultimoChat || 0) < 1500) return;   // 1 mensagem a cada 1,5 s
    socket.ultimoChat = agora;
    const eu = sala.jogadores.find(j => j.socketId === socket.id);
    const n = (eu && eu.nome) || String(nome || '').trim().slice(0, 20) || 'Jogador';
    io.to(sala.id).emit('chat:msg', { nome: n, texto: t });
  });

  socket.on('jogo:rolar', () => {
    const sala = salas[socket.data.salaId];
    if (!sala || !sala.iniciado) return;

    const jogadorDoSocket = sala.jogadores.find(j => j.socketId === socket.id);
    if (!jogadorDoSocket) return;

    const estado = sala.estadoDoJogo;

    if (jogadorAtivoIndice(estado) !== jogadorDoSocket.indice) {
      socket.emit('jogo:erro', 'Não é a tua vez!');
      return;
    }
    if (estado.dadosDisponiveis.length > 0) {
      socket.emit('jogo:erro', 'Move as tuas peças antes de rolar de novo!');
      return;
    }
    if (estado.bonusesCaptura.length > 0) {
      socket.emit('jogo:erro', 'Usa o bónus de captura antes de rolar de novo!');
      return;
    }

    const dados = rolarDados(estado);

    pagarMatadas(sala);
    io.to(sala.id).emit('jogo:dadosRolados', { jogador: jogadorDoSocket.indice, dados });
    io.to(sala.id).emit('estadoAtualizado', estado);

    if (estado.jogoTerminado) {
      iniciarFaseDeDecisao(sala);
    }
  });

   socket.on('jogo:mover', ({ pecaId, destinoId }) => {
    const sala = salas[socket.data.salaId];
    if (!sala || !sala.iniciado) return;

    const jogadorDoSocket = sala.jogadores.find(j => j.socketId === socket.id);
    if (!jogadorDoSocket) return;

    const estado = sala.estadoDoJogo;

    if (jogadorAtivoIndice(estado) !== jogadorDoSocket.indice || jogadorDaPeca(pecaId) !== jogadorDoSocket.indice) {
      socket.emit('jogo:erro', 'Não é a tua vez, ou essa peça não é tua!');
      return;
    }

    const resultado = moverPeca(estado, pecaId, destinoId);
    pagarMatadas(sala);
    if (!resultado.sucesso) {
      socket.emit('jogo:erro', resultado.motivo);
      return;
    }

    io.to(sala.id).emit('estadoAtualizado', estado);

    if (estado.jogoTerminado) {
      iniciarFaseDeDecisao(sala);
    }
  });

  // Depois do jogo terminar: cada jogador escolhe 'continuar' ou 'sair'
  socket.on('posJogo:decisao', ({ decisao }) => {
    const sala = salas[socket.data.salaId];
    if (!sala || !sala.aguardandoDecisao) return;
    if (decisao !== 'continuar' && decisao !== 'sair') return;

    sala.decisoes[socket.id] = decisao;
    resolverDecisoesPosJogo(sala);
  });
  socket.on('disconnect', () => {
    console.log('Desligado:', socket.id);
    removerJogadorDeTodasAsSalas(socket.id);
  });
});

// HISTÓRICO: o Render envia SIGTERM em cada deploy/reinício; grava o que falta antes de sair
['SIGTERM', 'SIGINT'].forEach(sinal => {
  process.on(sinal, async () => {
    await historico.salvarAntesDeSair();
    process.exit(0);
  });
});

const PORTA = process.env.PORT || 3000;

// HISTÓRICO: carrega o histórico antes de aceitar jogadores. Se falhar, o jogo funciona
// na mesma (só sem registar) e o motivo aparece nos logs.
historico.carregar()
  .catch(e => console.error('Histórico DESATIVADO:', e.message))
  .then(() => contas.iniciar())
  .catch(e => console.error('Contas DESATIVADAS:', e.message))
  .then(() => {
    server.listen(PORTA, () => {
      console.log('Servidor Nante a correr em http://localhost:' + PORTA);
    });
  });

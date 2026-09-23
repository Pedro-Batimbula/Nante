const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { criarEstadoInicial, jogadoresAtivosIndices, jogadorAtivoIndice, jogadorDaPeca, rolarDados, moverPeca, marcarAbandono } = require('./regras');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

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
    iniciado: sala.iniciado
  };
}

// Lista de todas as salas ainda em espera (não iniciadas, com vaga) - para o lobby mostrar
// ao jogador antes de ele escolher onde entrar.
function listaDeSalasEmEspera() {
  return Object.values(salas)
    .filter(s => !s.iniciado && s.jogadores.length < s.totalPlayers)
    .map(estadoPublicoDaSala);
}

function avisarTodosDaListaDeSalas() {
  io.emit('lobby:salas', listaDeSalasEmEspera());
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
    if (todosSairam) {
      delete salas[sala.id];
    }
    avisarTodosDaListaDeSalas();
  });
}

// Emite os resultados finais e coloca a sala em modo de decisão: cada jogador escolhe
// "continuar" (recomeçar com os mesmos jogadores) ou "sair".
function iniciarFaseDeDecisao(sala) {
  sala.aguardandoDecisao = true;
  sala.decisoes = {};

  const classificacaoFinal = sala.jogadores
    .map(j => ({ nome: j.nome, indice: j.indice, classificacao: sala.estadoDoJogo.jogadores[j.indice].classificacao, abandonou: sala.estadoDoJogo.jogadores[j.indice].abandonou }))
    .sort((a, b) => (a.classificacao ?? 99) - (b.classificacao ?? 99));

  io.to(sala.id).emit('jogo:terminado', { classificacaoFinal });
}

// Quando todos os jogadores CONECTADOS já decidiram, resolve: quem quer continuar joga de
// novo (com estado novo); quem sai é removido da sala.
function resolverDecisoesPosJogo(sala) {
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

  if (sala.jogadores.length === sala.totalPlayers) {
    sala.iniciado = true;
    sala.estadoDoJogo = criarEstadoInicial(sala.totalPlayers, sala.totalPecas);
    io.to(sala.id).emit('jogo:iniciar', estadoPublicoDaSala(sala));
    io.to(sala.id).emit('estadoAtualizado', sala.estadoDoJogo);
  } else {
    sala.iniciado = false;
    sala.estadoDoJogo = null;
    io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
  }
  avisarTodosDaListaDeSalas();
}

io.on('connection', (socket) => {
  console.log('Ligado:', socket.id);

  // Junta um jogador a uma sala (nova ou existente) e trata do início do jogo se completar.
  function entrarNaSala(socket, sala, nome) {
    const indice = jogadoresAtivosIndices(sala.totalPlayers)[sala.jogadores.length];
    const nomeFinal = (nome || '').trim() || ('Jogador ' + (indice + 1));

    sala.jogadores.push({ socketId: socket.id, nome: nomeFinal, indice });
    socket.join(sala.id);
    socket.data.salaId = sala.id;

    socket.emit('lobby:voce', { indice, nome: nomeFinal });
    io.to(sala.id).emit('lobby:atualizado', estadoPublicoDaSala(sala));
    avisarTodosDaListaDeSalas();

    if (sala.jogadores.length === sala.totalPlayers) {
      sala.iniciado = true;
      sala.estadoDoJogo = criarEstadoInicial(sala.totalPlayers, sala.totalPecas);

      io.to(sala.id).emit('jogo:iniciar', estadoPublicoDaSala(sala));
      io.to(sala.id).emit('estadoAtualizado', sala.estadoDoJogo);
      avisarTodosDaListaDeSalas();
    }
  }

  // Cliente pede para entrar no lobby, com as preferências de nº de jogadores/peças.
  // Junta-se automaticamente a uma sala compatível existente, ou cria uma nova.
  socket.on('lobby:entrar', ({ nome, totalPlayers, totalPecas }) => {
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
  socket.on('lobby:entrarNaSala', ({ salaId, nome }) => {
    const sala = salas[salaId];
    if (!sala || sala.iniciado || sala.jogadores.length >= sala.totalPlayers) {
      socket.emit('jogo:erro', 'Essa sala já não está disponível.');
      socket.emit('lobby:salas', listaDeSalasEmEspera());
      return;
    }
    entrarNaSala(socket, sala, nome);
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

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
  console.log('Servidor Nante a correr em http://localhost:' + PORTA);
});

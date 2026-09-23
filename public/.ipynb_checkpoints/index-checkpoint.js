const socket = io();

// ===== Elementos DOM do tabuleiro =====
const RollBtn = document.getElementById('RollBtn');
const DiceTable = document.getElementById('DiceTable');
const main = document.getElementById('main');
const banners = [
  document.querySelector('.P1'),
  document.querySelector('.P2'),
  document.querySelector('.P3'),
  document.querySelector('.P4')
];

// ===== Elementos do lobby =====
const lobbyOverlay = document.getElementById('lobbyOverlay');
const lobbyNome = document.getElementById('lobbyNome');
const lobbyPlayers = document.getElementById('lobbyPlayers');
const lobbyPecas = document.getElementById('lobbyPecas');
const lobbyEntrarBtn = document.getElementById('lobbyEntrarBtn');
const lobbyStatus = document.getElementById('lobbyStatus');
const listaSalas = document.getElementById('listaSalas');

let nomesPorIndice = {}; // jogadorIndice -> nome, para desenhar nos banners

const DiceHtml = {
  1: '<div class="dice"><div class="S1"></div></div>',
  2: '<div class="dice"><div class="K1"></div><div class="K1"></div></div>',
  3: '<div class="dice3"><div class="lin1"><div class="L1"></div></div><div class="lin2"><div class="L1"></div></div><div class="lin3"><div class="L1"></div></div></div>',
  4: '<div class="dice4"><div class="lin1"><div class="L1"></div><div class="L1"></div></div><div class="lin2"></div><div class="lin3"><div class="L1"></div><div class="L1"></div></div></div>',
  5: '<div class="dice5"><div class="lin1"><div class="L1"></div><div class="L1"></div></div><div class="lin2"><div class="L1"></div></div><div class="lin3"><div class="L1"></div><div class="L1"></div></div></div>',
  6: '<div class="dice6"><div class="lin1"><div class="L1"></div><div class="L1"></div><div class="L1"></div></div><div class="lin2"><div class="L1"></div><div class="L1"></div><div class="L1"></div></div><div class="lin3"><div class="L1"></div><div class="L1"></div><div class="L1"></div></div></div>'
};

// ===== Estado vindo do servidor =====
let estadoAtual = null;
let meuIndice = null;
let pecaSelecionadaId = null;

// ===== Lobby =====
lobbyEntrarBtn.addEventListener('click', () => {
  const nome = lobbyNome.value.trim() || undefined;
  const totalPlayers = Number(lobbyPlayers.value);
  const totalPecas = Number(lobbyPecas.value);
  socket.emit('lobby:entrar', { nome, totalPlayers, totalPecas });
  lobbyEntrarBtn.disabled = true;
  lobbyStatus.textContent = 'À espera de mais jogadores...';
});

socket.emit('lobby:listarSalas');

socket.on('lobby:salas', (salas) => {
  listaSalas.innerHTML = '';
  if (salas.length === 0) {
    listaSalas.innerHTML = '<li>Nenhuma sala em espera.</li>';
    return;
  }
  salas.forEach(sala => {
    const li = document.createElement('li');
    const nomesJogadores = sala.jogadores.map(j => j.nome).join(', ') || '(vazia)';
    li.textContent = sala.totalPlayers + ' jogadores / ' + sala.totalPecas + ' peças — ' +
      sala.jogadores.length + '/' + sala.totalPlayers + ' — ' + nomesJogadores;
    li.classList.add('sala-item');
    li.addEventListener('click', () => {
      const nome = lobbyNome.value.trim() || undefined;
      socket.emit('lobby:entrarNaSala', { salaId: sala.id, nome });
      lobbyEntrarBtn.disabled = true;
      lobbyStatus.textContent = 'À espera de mais jogadores...';
    });
    listaSalas.appendChild(li);
  });
});

socket.on('lobby:voce', ({ indice, nome }) => {
  meuIndice = indice;
  if (nome) nomesPorIndice[indice] = nome;
});

socket.on('lobby:atualizado', (salaPublica) => {
  lobbyStatus.textContent = 'Jogadores na sala: ' + salaPublica.jogadores.length + '/' + salaPublica.totalPlayers;
  salaPublica.jogadores.forEach(j => { nomesPorIndice[j.indice] = j.nome; });
});

socket.on('jogo:iniciar', () => {
  lobbyOverlay.classList.add('escondido');
});

socket.on('estadoAtualizado', (estado) => {
  estadoAtual = estado;
  renderizarEstado(estado);
});

socket.on('jogo:dadosRolados', ({ dados }) => {
  mostrarDados(dados);
});

socket.on('jogo:erro', (mensagem) => {
  window.alert(mensagem);
});

socket.on('jogo:terminado', ({ classificacaoFinal }) => {
  const linhas = classificacaoFinal.map(j => {
    if (j.abandonou) return j.nome + ': abandonou';
    return j.classificacao + 'º lugar: ' + j.nome;
  });
  const quer = window.confirm('Jogo terminado!\n' + linhas.join('\n') + '\n\nQueres jogar de novo com os mesmos jogadores?');
  socket.emit('posJogo:decisao', { decisao: quer ? 'continuar' : 'sair' });
  if (!quer) {
    lobbyOverlay.classList.remove('escondido');
    lobbyStatus.textContent = 'Saíste da sala. Escolhe as opções para entrar noutro jogo.';
    lobbyEntrarBtn.disabled = false;
  }
});
// ===== Posicionamento visual (mesma lógica geométrica do jogo original) =====
function posicionarPecaEm(pecaEl, destinoEl, dx = 0, dy = 0) {
  const rect = destinoEl.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  const centroX = rect.left - mainRect.left + rect.width / 2;
  const centroY = rect.top - mainRect.top + rect.height / 2;
  pecaEl.style.left = (centroX + dx - pecaEl.offsetWidth / 2) + 'px';
  pecaEl.style.top = (centroY + dy - pecaEl.offsetHeight / 2) + 'px';
}

function offsetPorIndice(indice, total) {
  if (total <= 1) return { dx: 0, dy: 0 };
  const raio = 8;
  const anguloBase = (2 * Math.PI) / total;
  const angulo = anguloBase * indice - Math.PI / 2;
  return { dx: Math.round(Math.cos(angulo) * raio), dy: Math.round(Math.sin(angulo) * raio) };
}

function offsetPorSlotNinho(slot) {
  const slots = [{ dx: -10, dy: -10 }, { dx: 10, dy: -10 }, { dx: -10, dy: 10 }, { dx: 10, dy: 10 }];
  return slots[slot] || { dx: 0, dy: 0 };
}

function posicionarNoNinho(pecaEl, jogadorIndice, slot) {
  const ninho = document.getElementById('ninho-' + jogadorIndice);
  if (!ninho) return;
  const { dx, dy } = offsetPorSlotNinho(slot);
  posicionarPecaEm(pecaEl, ninho, dx, dy);
}

// ===== Render principal: desenha TUDO a partir do estado recebido do servidor =====
function jogadorAtivoIndiceLocal(estado) {
  return estado.ativos[estado.jogadorAtivoPos];
}

function renderizarEstado(estado) {
  aplicarClassesDePecasInativas(estado.totalPecas);
  aplicarJogadoresInativos(estado.ativos);

  // Posiciona cada peça na sua casa/ninho atual
  Object.keys(estado.ocupacao).forEach(casaId => {
    const ocupantes = estado.ocupacao[casaId] || [];
    const ehNinhoDePartida = casaId.startsWith('ninho-') && !casaId.startsWith('ninho-4-');

    ocupantes.forEach((pecaId, indice) => {
      const pecaEl = document.getElementById(pecaId);
      if (!pecaEl) return;

      if (ehNinhoDePartida) {
        const jogadorIndice = Number(pecaId.split('-')[0].replace('P', '')) - 1;
        const slot = Number(pecaId.split('-')[1]);
        posicionarNoNinho(pecaEl, jogadorIndice, slot);
      } else {
        const destinoEl = document.getElementById(casaId);
        if (!destinoEl) return;
        const { dx, dy } = offsetPorIndice(indice, ocupantes.length);
        posicionarPecaEm(pecaEl, destinoEl, dx, dy);
      }
    });
  });

  // Marca peças terminadas
  document.querySelectorAll('.peca').forEach(pecaEl => {
    pecaEl.classList.toggle('terminada', !!estado.pecasTerminadas[pecaEl.id]);
  });

  // Banner do jogador ativo, com o nome real em vez de "Player X"
  const jogadorAtivo = jogadorAtivoIndiceLocal(estado);
  banners.forEach((banner, i) => {
    banner.classList.toggle('removed', i !== jogadorAtivo);
    banner.classList.toggle('show', i === jogadorAtivo);
    if (i === jogadorAtivo) {
      banner.textContent = nomesPorIndice[i] || ('Jogador ' + (i + 1));
    }
  });

  // Destinos possíveis: só desenha luzes se for a MINHA vez
  limparDestaquesDeJogada();
  if (meuIndice === jogadorAtivo) {
    destacarPecasComMovimento(estado.destinosPorPeca);
    if (pecaSelecionadaId && estado.destinosPorPeca[pecaSelecionadaId]) {
      pintarDestinosDaPeca(estado.destinosPorPeca[pecaSelecionadaId]);
    }
  }
}

function limparDestaquesDeJogada() {
  document.querySelectorAll('.destino-possivel').forEach(el => el.classList.remove('destino-possivel'));
  document.querySelectorAll('.peca.pode-mover').forEach(el => el.classList.remove('pode-mover'));
}

function destacarPecasComMovimento(destinosPorPeca) {
  Object.keys(destinosPorPeca || {}).forEach(pecaId => {
    if (Object.keys(destinosPorPeca[pecaId]).length > 0) {
      const pecaEl = document.getElementById(pecaId);
      if (pecaEl) pecaEl.classList.add('pode-mover');
    }
  });
}

function pintarDestinosDaPeca(mapaDestinos) {
  Object.keys(mapaDestinos).forEach(casaId => {
    const casaEl = document.getElementById(casaId);
    if (casaEl) casaEl.classList.add('destino-possivel');
  });
}

function aplicarClassesDePecasInativas(totalPecas) {
  document.querySelectorAll('.peca').forEach(pecaEl => {
    const slot = Number(pecaEl.dataset.peca);
    pecaEl.classList.toggle('inativa', slot >= totalPecas);
  });
}

function aplicarJogadoresInativos(ativos) {
  [0, 1, 2, 3].forEach(i => {
    document.querySelectorAll('.peca[data-jogador="' + i + '"]').forEach(pecaEl => {
      pecaEl.classList.toggle('off', !ativos.includes(i));
    });
  });
}

function mostrarDados(dados) {
  DiceTable.innerHTML = '';
  dados.forEach(valor => { DiceTable.innerHTML += DiceHtml[valor]; });
}

// ===== Interação: clique em peça =====
document.querySelectorAll('.peca').forEach(pecaEl => {
  pecaEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!estadoAtual) return;

    const jogadorAtivo = jogadorAtivoIndiceLocal(estadoAtual);
    if (meuIndice !== jogadorAtivo) {
      window.alert('Não é a tua vez!');
      return;
    }
    if (estadoAtual.pecasTerminadas[pecaEl.id]) {
      window.alert('Essa peça já terminou o percurso!');
      return;
    }
    if (estadoAtual.pecaIndiceNoPercurso[pecaEl.id] === -1) {
      window.alert('Essa peça ainda está no ninho — só entra automaticamente ao tirares 6!');
      return;
    }

    if (pecaSelecionadaId === pecaEl.id) {
      pecaSelecionadaId = null;
      pecaEl.classList.remove('selecionada');
      limparDestaquesDeJogada();
      destacarPecasComMovimento(estadoAtual.destinosPorPeca);
      return;
    }

    document.querySelectorAll('.peca.selecionada').forEach(p => p.classList.remove('selecionada'));
    pecaSelecionadaId = pecaEl.id;
    pecaEl.classList.add('selecionada');

    limparDestaquesDeJogada();
    destacarPecasComMovimento(estadoAtual.destinosPorPeca);
    const mapaDestinos = estadoAtual.destinosPorPeca[pecaEl.id];
    if (mapaDestinos) pintarDestinosDaPeca(mapaDestinos);
  });
});

// ===== Interação: clique em casa/ninho =====
function tentarMoverPara(destinoId) {
  if (!pecaSelecionadaId) return;
  socket.emit('jogo:mover', { pecaId: pecaSelecionadaId, destinoId });
  pecaSelecionadaId = null;
  document.querySelectorAll('.peca.selecionada').forEach(p => p.classList.remove('selecionada'));
}

document.querySelectorAll('.check').forEach(casaEl => {
  casaEl.addEventListener('click', () => tentarMoverPara(casaEl.id));
});

document.querySelectorAll('.ninho').forEach(ninhoEl => {
  ninhoEl.addEventListener('click', () => tentarMoverPara(ninhoEl.id));
});

// ===== Interação: rolar dados =====
RollBtn.addEventListener('click', () => {
  socket.emit('jogo:rolar');
});

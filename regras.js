// ===== Percursos do tabuleiro =====
const laçoExterno = [
  'HE6','HE7','HE8','HE9','HE10','HE11','HE12','HE13','HE14',
  'MHEF',
  'HE16','HE17','HE18','HE19','HEF','HE1','HE2','HE3','HE4','VBE5',
  'VB6','VB7','VB8','VB9','VBF10','VB11','VB12','VB13','VB14',
  'MVBF',
  'VB16','VB17','VB18','VB19','VBF','VB1','VB2','VB3','VB4','VBD5',
  'HD6','HD7','HD8','HD9','HD10','HD11','HD12','HD13','HD14',
  'MHDF',
  'HD16','HD17','HD18','HD19','HDF','HD1','HD2','HD3','HD4','VTD9',
  'VT6','VT7','VT8','VT9','VT10','VT11','VT12','VT13','VT14',
  'MVF',
  'VT16','VT17','VT18','VT19','VTF','VT1','VT2','VT3','VT4','VTE5'
];

const configJogador = [
  { armSixIndex: 20, casasColoridas: ['MVBF','MVB1','MVB2','MVB3','MVB4','MVB5','MVB6','MVB7','MVB8','MVBF9','ninho-4-0'] },
  { armSixIndex: 40, casasColoridas: ['MHDF','MHD1','MHD2','MHD3','MHD4','MHD5','MHD6','MHD7','MHD8','MDF9','ninho-4-1'] },
  { armSixIndex: 60, casasColoridas: ['MVF','MV1','MV2','MV3','MV4','MV5','MV6','MV7','MV8','MVTF9','ninho-4-2'] },
  { armSixIndex: 0,  casasColoridas: ['MHEF','MHEF1','MHEF2','MHEF3','MHEF4','MHEF5','MHEF6','MHEF7','MHEF8','MEF9','ninho-4-3'] }
];

function montarPercurso(indiceJogador) {
  const { armSixIndex, casasColoridas } = configJogador[indiceJogador];
  const largadaIndex = armSixIndex + 14;
  const turnIndex = armSixIndex + 9;
  const voltaCompleta = [
    ...laçoExterno.slice(largadaIndex),
    ...laçoExterno.slice(0, turnIndex)
  ];
  return [...voltaCompleta, ...casasColoridas];
}

const percursoPorJogador = [0, 1, 2, 3].map(montarPercurso);
const casaEntradaPorJogador = percursoPorJogador.map(percurso => percurso[0]);

function jogadoresAtivosIndices(totalPlayers) {
  if (totalPlayers === 2) return [0, 2];
  if (totalPlayers === 3) return [0, 1, 2];
  return [0, 1, 2, 3];
}

function combinacoesDados(dados) {
  const n = dados.length;
  const resultados = [];
  for (let mask = 1; mask < (1 << n); mask++) {
    let soma = 0;
    const indices = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        soma += dados[i];
        indices.push(i);
      }
    }
    resultados.push({ soma, indices });
  }
  resultados.sort((a, b) => a.indices.length - b.indices.length);
  return resultados;
}

function hasequal(lista) {
  const contador = {};
  const resultado = {};
  for (const num of lista) contador[num] = (contador[num] || 0) + 1;
  for (const num in contador) if (contador[num] > 1) resultado[num] = contador[num];
  return resultado;
}

function somaQuantidades(obj) {
  return Object.values(obj).reduce((total, qtd) => total + qtd, 0);
}

// ===== Estado inicial =====

function idsDePecasDoJogador(jogadorIndice, totalPecas) {
  const ids = [];
  for (let slot = 0; slot < totalPecas; slot++) ids.push('P' + (jogadorIndice + 1) + '-' + slot);
  return ids;
}

function criarJogador(jogadorIndice, emJogo, totalPecas) {
  return {
    indice: jogadorIndice,
    inGame: emJogo,
    totalPecas,
    pecasTerminadas: 0,
    classificacao: null,
    violado: false,
    abandonou: false
  };
}

const QUANTIDADE_DADOS_BASE = 2;

function criarEstadoInicial(totalPlayers, totalPecas) {
  const ativos = jogadoresAtivosIndices(totalPlayers);
  const ocupacao = {};
  const pecaLocalizacao = {};
  const pecaIndiceNoPercurso = {};

  const jogadores = [0, 1, 2, 3].map(i => criarJogador(i, ativos.includes(i), totalPecas));

  ativos.forEach(jogadorIndice => {
    const ninhoId = 'ninho-' + jogadorIndice;
    const pecaIds = idsDePecasDoJogador(jogadorIndice, totalPecas);
    ocupacao[ninhoId] = [...pecaIds];
    pecaIds.forEach(pecaId => {
      pecaLocalizacao[pecaId] = ninhoId;
      pecaIndiceNoPercurso[pecaId] = -1;
    });
  });

  return {
    totalPlayers,
    totalPecas,
    ativos,
    jogadorAtivoPos: 0,
    ocupacao,
    pecaLocalizacao,
    pecaIndiceNoPercurso,
    pecasTerminadas: {},
    destinosPorPeca: {},
    dadosDisponiveis: [],
    bonusesCaptura: [],
    bonusRolagem: false,
    quantidadeBase: QUANTIDADE_DADOS_BASE,
    quantidadeProximaRolagem: QUANTIDADE_DADOS_BASE,
    jogadores,
    proximaClassificacao: 1,
    jogoTerminado: false
  };
}

function jogadorAtivoIndice(estado) {
  return estado.ativos[estado.jogadorAtivoPos];
}

function jogadorDaPeca(pecaId) {
  return parseInt(pecaId.split('-')[0].slice(1), 10) - 1;
}

// ===== Metadados das casas =====

const CASAS_SEGURAS = ['HE10', 'HEF', 'VT10', 'VTF', 'VBF10', 'VBF', 'HD10', 'HDF'];
const CASAS_MULTIPLAS = ['MHEF', 'MVBF', 'MHDF', 'MVF'];

const CASA_EXCLUSIVA_DO_JOGADOR = {};
configJogador.forEach((cfg, jogadorIndice) => {
  cfg.casasColoridas.slice(-2).forEach(casaId => { CASA_EXCLUSIVA_DO_JOGADOR[casaId] = jogadorIndice; });
});

function ehCasaSegura(casaId) { return CASAS_SEGURAS.includes(casaId); }
function ehCasaMultipla(casaId) { return CASAS_MULTIPLAS.includes(casaId); }
function donoExclusivoDaCasa(casaId) { return CASA_EXCLUSIVA_DO_JOGADOR[casaId]; }

// ===== Consultas sobre peças =====

function pecasDoJogador(estado, jogador) {
  const total = estado.jogadores[jogador].totalPecas;
  const ids = [];
  for (let slot = 0; slot < total; slot++) ids.push('P' + (jogador + 1) + '-' + slot);
  return ids;
}

function pecasNoNinho(estado, jogador) {
  return pecasDoJogador(estado, jogador).filter(id =>
    estado.pecaIndiceNoPercurso[id] === -1 && !estado.pecasTerminadas[id]
  );
}

function pecasEmJogo(estado, jogador) {
  return pecasDoJogador(estado, jogador).filter(id =>
    estado.pecaIndiceNoPercurso[id] >= 0 && !estado.pecasTerminadas[id]
  );
}

// ===== Movimentação de baixo nível =====

function moverOcupacao(estado, pecaId, destinoId) {
  const origemId = estado.pecaLocalizacao[pecaId];
  if (origemId && estado.ocupacao[origemId]) {
    estado.ocupacao[origemId] = estado.ocupacao[origemId].filter(id => id !== pecaId);
  }
  estado.ocupacao[destinoId] = estado.ocupacao[destinoId] || [];
  estado.ocupacao[destinoId].push(pecaId);
  estado.pecaLocalizacao[pecaId] = destinoId;
}

function capturarPeca(estado, pecaId) {
  moverOcupacao(estado, pecaId, 'ninho-' + jogadorDaPeca(pecaId));
  estado.pecaIndiceNoPercurso[pecaId] = -1;
}

function marcarViolacoesAoLongoDoCaminho(estado, percursoDaPeca, jogadorDono, indiceInicio, indiceFim) {
  for (let i = indiceInicio + 1; i <= indiceFim; i++) {
    const casaId = percursoDaPeca[i];
    casaEntradaPorJogador.forEach((entradaId, jogadorDaEntrada) => {
      if (jogadorDaEntrada !== jogadorDono && casaId === entradaId) {
        estado.jogadores[jogadorDaEntrada].violado = true;
      }
    });
  }
}

function esmagarNaEntrada(estado, casaEntradaId, jogadorDono, entrandoEmDupla) {
  const ocupantesAntes = [...(estado.ocupacao[casaEntradaId] || [])];
  const alheias = ocupantesAntes.filter(id => jogadorDaPeca(id) !== jogadorDono);

  if (entrandoEmDupla) {
    alheias.forEach(id => capturarPeca(estado, id));
    return;
  }
  if (ocupantesAntes.length < 2) return;
  if (alheias.length > 0) capturarPeca(estado, alheias[0]);
}

// ===== Fim de jogo / abandono =====

function jogadoresRestantesEmJogo(estado) {
  return estado.jogadores.filter(p => p.inGame && p.classificacao === null && !p.abandonou);
}

function verificarFimDeJogo(estado) {
  const restantes = jogadoresRestantesEmJogo(estado);
  if (restantes.length <= 1) {
    estado.jogoTerminado = true;
    if (restantes.length === 1) {
      restantes[0].classificacao = estado.proximaClassificacao;
    }
  }
}

function verificarVitoriaJogador(estado, jogador) {
  const p = estado.jogadores[jogador];
  if (p.pecasTerminadas >= p.totalPecas && p.classificacao === null) {
    p.classificacao = estado.proximaClassificacao++;
    verificarFimDeJogo(estado);
  }
}

// Marca um jogador como tendo abandonado a partida (saída repentina). Não conta como
// vitória nem derrota - fica de fora da classificação. Se era a vez dele, passa o turno.
function marcarAbandono(estado, jogadorIndice) {
  const jogador = estado.jogadores[jogadorIndice];
  if (!jogador || jogador.abandonou || jogador.classificacao !== null) return;

  jogador.abandonou = true;

  if (!estado.jogoTerminado && jogadorAtivoIndice(estado) === jogadorIndice) {
    trocarJogador(estado);
  }

  verificarFimDeJogo(estado);
}

// ===== Movimento com regras =====

function moverPecaComRegras(estado, pecaId, destinoId, indiceDestino) {
  const ehNinhoPartida = destinoId.startsWith('ninho-') && !destinoId.startsWith('ninho-4-');
  let capturasNesteMovimento = 0;

  if (!ehNinhoPartida && !ehCasaMultipla(destinoId)) {
    const ocupantes = (estado.ocupacao[destinoId] || []).filter(id => id !== pecaId);

    if (ocupantes.length === 2) {
      const jogadorOcupante0 = jogadorDaPeca(ocupantes[0]);
      const mesmoJogadorQueOcupantes = ocupantes.every(id => jogadorDaPeca(id) === jogadorOcupante0);
      const eMuroAdversario = mesmoJogadorQueOcupantes && jogadorOcupante0 !== jogadorDaPeca(pecaId);

      if (eMuroAdversario && !ehCasaSegura(destinoId)) {
        ocupantes.forEach(id => capturarPeca(estado, id));
        capturasNesteMovimento = ocupantes.length;
      } else {
        return { sucesso: false, motivo: 'Essa casa já está cheia!' };
      }
    } else if (!ehCasaSegura(destinoId) && ocupantes.length === 1) {
      const pecaOcupante = ocupantes[0];
      if (jogadorDaPeca(pecaOcupante) !== jogadorDaPeca(pecaId)) {
        capturarPeca(estado, pecaOcupante);
        capturasNesteMovimento = 1;
      }
    }
  }

  const indiceAntesDoMovimento = estado.pecaIndiceNoPercurso[pecaId];
  if (!ehNinhoPartida && indiceAntesDoMovimento >= 0 && indiceDestino > indiceAntesDoMovimento) {
    const jogadorDono = jogadorDaPeca(pecaId);
    marcarViolacoesAoLongoDoCaminho(estado, percursoPorJogador[jogadorDono], jogadorDono, indiceAntesDoMovimento, indiceDestino);
  }

  moverOcupacao(estado, pecaId, destinoId);
  estado.pecaIndiceNoPercurso[pecaId] = ehNinhoPartida ? -1 : indiceDestino;

  if (!ehNinhoPartida && capturasNesteMovimento >= 2) {
    estado.bonusesCaptura.push(20, 40);
  } else if (!ehNinhoPartida && capturasNesteMovimento === 1) {
    estado.bonusesCaptura.push(20);
  }

  if (destinoId.startsWith('ninho-4-')) {
    const jogadorDaPecaMovida = jogadorDaPeca(pecaId);
    estado.pecasTerminadas[pecaId] = true;
    estado.jogadores[jogadorDaPecaMovida].pecasTerminadas++;
    estado.bonusesCaptura.push(10);
    verificarVitoriaJogador(estado, jogadorDaPecaMovida);
  }

  return { sucesso: true, capturas: capturasNesteMovimento };
}

function processarEntradasAutomaticas(estado) {
  const jogador = jogadorAtivoIndice(estado);
  const percurso = percursoPorJogador[jogador];
  const casaEntrada = percurso[0];
  const jaViolado = estado.jogadores[jogador].violado;

  let continuar = true;
  while (continuar) {
    continuar = false;
    const indiceSeis = estado.dadosDisponiveis.indexOf(6);
    if (indiceSeis === -1) break;

    const naNinho = pecasNoNinho(estado, jogador);
    if (naNinho.length === 0) break;

    if (!jaViolado) {
      const entradaTemPecaPropria = (estado.ocupacao[casaEntrada] || [])
        .some(id => jogadorDaPeca(id) === jogador);

      if (!entradaTemPecaPropria && naNinho.length >= 2) {
        estado.dadosDisponiveis.splice(indiceSeis, 1);
        esmagarNaEntrada(estado, casaEntrada, jogador, true);
        const [pecaA, pecaB] = naNinho;
        moverPecaComRegras(estado, pecaA, casaEntrada, 0);
        moverPecaComRegras(estado, pecaB, casaEntrada, 0);

        if (estado.dadosDisponiveis.length > 0) {
          const outroDado = estado.dadosDisponiveis.shift();
          const indiceDestino = Math.min(outroDado, percurso.length - 1);
          moverPecaComRegras(estado, pecaB, percurso[indiceDestino], indiceDestino);
        }
      } else {
        estado.dadosDisponiveis.splice(indiceSeis, 1);
        esmagarNaEntrada(estado, casaEntrada, jogador, false);
        const peca = naNinho[0];
        moverPecaComRegras(estado, peca, casaEntrada, 0);

        if (estado.dadosDisponiveis.length > 0) {
          const outroDado = estado.dadosDisponiveis.shift();
          const indiceDestino = Math.min(outroDado, percurso.length - 1);
          moverPecaComRegras(estado, peca, percurso[indiceDestino], indiceDestino);
        }
      }
    } else {
      estado.dadosDisponiveis.splice(indiceSeis, 1);
      esmagarNaEntrada(estado, casaEntrada, jogador, false);
      const peca = naNinho[0];
      moverPecaComRegras(estado, peca, casaEntrada, 0);
    }
    continuar = true;
  }
}

// Avança para o próximo jogador ainda em jogo (pula quem já terminou ou abandonou).
// Também reinicia a quantidade de dados da próxima rolagem para o valor base.
function trocarJogador(estado) {
  const ativos = estado.ativos;
  let proxPosicao = estado.jogadorAtivoPos;
  let proxIndiceReal;
  let tentativas = 0;
  do {
    proxPosicao = (proxPosicao + 1) % ativos.length;
    proxIndiceReal = ativos[proxPosicao];
    tentativas++;
  } while (
    (estado.jogadores[proxIndiceReal].classificacao !== null || estado.jogadores[proxIndiceReal].abandonou) &&
    tentativas <= ativos.length
  );

  estado.jogadorAtivoPos = proxPosicao;
  estado.dadosDisponiveis = [];
  estado.bonusesCaptura = [];
  estado.bonusRolagem = false;
  estado.destinosPorPeca = {};
  estado.quantidadeProximaRolagem = estado.quantidadeBase;
}

function passarVezOuContinuar(estado) {
  const jogadorAtivo = jogadorAtivoIndice(estado);
  if (estado.jogadores[jogadorAtivo].classificacao !== null || estado.jogadores[jogadorAtivo].abandonou) {
    estado.bonusRolagem = false;
    trocarJogador(estado);
    return;
  }
  if (!estado.bonusRolagem) {
    trocarJogador(estado);
  }
  estado.bonusRolagem = false;
}

function calcularDestinosPorPeca(estado) {
  const destinos = {};
  const jogadorAtivo = jogadorAtivoIndice(estado);
  const percurso = percursoPorJogador[jogadorAtivo];
  const combos = combinacoesDados(estado.dadosDisponiveis);

  pecasEmJogo(estado, jogadorAtivo).forEach(pecaId => {
    const indiceAtual = estado.pecaIndiceNoPercurso[pecaId];
    const mapaDestinos = {};

    combos.forEach(({ soma, indices }) => {
      const indiceDestino = indiceAtual + soma;
      if (indiceDestino >= percurso.length) return;
      const casaId = percurso[indiceDestino];
      if (!(casaId in mapaDestinos)) mapaDestinos[casaId] = { indiceDestino, indicesDados: indices };
    });

    estado.bonusesCaptura.forEach(avanco => {
      const indiceDestino = indiceAtual + avanco;
      if (indiceDestino >= percurso.length) return;
      const casaId = percurso[indiceDestino];
      if (!(casaId in mapaDestinos)) mapaDestinos[casaId] = { indiceDestino, indicesDados: { bonus: avanco } };
    });

    destinos[pecaId] = mapaDestinos;
  });

  estado.destinosPorPeca = destinos;
  return destinos;
}

function existeMovimentoPossivel(destinosPorPeca) {
  return Object.values(destinosPorPeca).some(mapa => Object.keys(mapa).length > 0);
}

// ===== Rolagem de dados =====
// Regras de repetição (idênticas ao motor original do cliente):
// - Dois (ou mais) dados com o MESMO valor -> repete, e a próxima rolagem usa tantos dados
//   quantos os que empataram (ex: 3,3 -> próxima rolagem com 2 dados).
// - Exatamente um 6 (sem repetir com outro dado) -> repete, mas a próxima rolagem usa SÓ 1 dado.
// - Nem repetido nem 6 -> não repete, próxima rolagem volta ao valor base (2).
function rolarDados(estado) {
  const quantidade = estado.quantidadeProximaRolagem || estado.quantidadeBase;
  const dados = [];
  for (let i = 0; i < quantidade; i++) dados.push(Math.floor(Math.random() * 6) + 1);

  const repetidos = hasequal(dados);
  const temRepetido = Object.keys(repetidos).length > 0;
  const temSeis = dados.includes(6);
  const qtdSeis = dados.filter(d => d === 6).length;
  const somaRepetidos = somaQuantidades(repetidos);

  if (temRepetido) {
    let novaQuantidade = somaRepetidos;
    if (temSeis && qtdSeis === 1) novaQuantidade += 1;
    estado.quantidadeProximaRolagem = novaQuantidade;
    estado.bonusRolagem = true;
  } else if (temSeis) {
    estado.quantidadeProximaRolagem = 1;
    estado.bonusRolagem = true;
  } else {
    estado.quantidadeProximaRolagem = estado.quantidadeBase;
    estado.bonusRolagem = false;
  }

  console.log('Dados rolados:', dados, '| próxima quantidade:', estado.quantidadeProximaRolagem, '| bonus:', estado.bonusRolagem);
  estado.dadosDisponiveis = [...dados];

  processarEntradasAutomaticas(estado);

  const jogadorAtivo = jogadorAtivoIndice(estado);

  if (pecasEmJogo(estado, jogadorAtivo).length === 0 && estado.bonusesCaptura.length === 0) {
    estado.dadosDisponiveis = [];
    passarVezOuContinuar(estado);
    return dados;
  }

  if (estado.dadosDisponiveis.length === 0 && estado.bonusesCaptura.length === 0) {
    passarVezOuContinuar(estado);
    return dados;
  }

  calcularDestinosPorPeca(estado);

  if (!existeMovimentoPossivel(estado.destinosPorPeca)) {
    estado.dadosDisponiveis = [];
    estado.bonusesCaptura = [];
    passarVezOuContinuar(estado);
  }

  return dados;
}

function moverPeca(estado, pecaId, destinoId) {
  const jogadorAtivo = jogadorAtivoIndice(estado);

  if (jogadorDaPeca(pecaId) !== jogadorAtivo) {
    return { sucesso: false, motivo: 'Não é a tua vez!' };
  }
  if (estado.pecasTerminadas[pecaId]) {
    return { sucesso: false, motivo: 'Essa peça já terminou o percurso!' };
  }
  if (estado.pecaIndiceNoPercurso[pecaId] === -1) {
    return { sucesso: false, motivo: 'Essa peça ainda está no ninho - só entra automaticamente com um 6!' };
  }

  const donoExclusivo = donoExclusivoDaCasa(destinoId);
  if (donoExclusivo !== undefined && donoExclusivo !== jogadorAtivo) {
    return { sucesso: false, motivo: 'Essa casa é exclusiva de outro jogador!' };
  }

  const mapaDestinos = estado.destinosPorPeca ? estado.destinosPorPeca[pecaId] : null;
  const opcao = mapaDestinos ? mapaDestinos[destinoId] : null;
  if (!opcao) {
    return { sucesso: false, motivo: 'Essa casa não é alcançável com os dados que tens!' };
  }

  const resultado = moverPecaComRegras(estado, pecaId, destinoId, opcao.indiceDestino);
  if (!resultado.sucesso) return resultado;

  if (opcao.indicesDados && opcao.indicesDados.bonus !== undefined) {
    const posicaoBonus = estado.bonusesCaptura.indexOf(opcao.indicesDados.bonus);
    if (posicaoBonus !== -1) estado.bonusesCaptura.splice(posicaoBonus, 1);
  } else {
    [...opcao.indicesDados].sort((a, b) => b - a).forEach(i => estado.dadosDisponiveis.splice(i, 1));
  }

  if (estado.dadosDisponiveis.length > 0 || estado.bonusesCaptura.length > 0) {
    calcularDestinosPorPeca(estado);
    if (!existeMovimentoPossivel(estado.destinosPorPeca)) {
      estado.dadosDisponiveis = [];
      estado.bonusesCaptura = [];
      passarVezOuContinuar(estado);
    }
  } else {
    estado.destinosPorPeca = {};
    passarVezOuContinuar(estado);
  }

  return { sucesso: true };
}

module.exports = {
  laçoExterno,
  configJogador,
  percursoPorJogador,
  casaEntradaPorJogador,
  jogadoresAtivosIndices,
  combinacoesDados,
  criarEstadoInicial,
  jogadorAtivoIndice,
  jogadorDaPeca,
  rolarDados,
  moverPeca,
  marcarAbandono,
  existeMovimentoPossivel,
  calcularDestinosPorPeca,
  pecasEmJogo,
  pecasNoNinho,
  ehCasaSegura,
  ehCasaMultipla
};
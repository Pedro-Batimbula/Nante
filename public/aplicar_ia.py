# Aplica as 11 edições da IA ao server.js (faz cópia de segurança server.backup.js)
import shutil, sys
raw = open('server.js', encoding='utf-8', newline='').read()
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')

if 'ia:jogar' in s:
    sys.exit('server.js já tem as edições da IA. Nada a fazer.')

def sub(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit('PAROU: ancora nao unica (%d ocorrencias): %s' % (n, old[:70]))
    s = s.replace(old, new)

sub("rolarDados, moverPeca, marcarAbandono } = require('./regras');",
    "rolarDados, moverPeca, marcarAbandono, passarVezOuContinuar } = require('./regras');\nconst { escolherJogada } = require('./ia');   // IA")
sub("if (!est || !est.matadas || !est.matadas.length) return;",
    "if (!est || !est.matadas || !est.matadas.length) return;\n  if (sala.ia) { est.matadas.length = 0; return; }   // IA: sem moedas")
sub("historico.registarFim(sala.jogoId, sala.estadoDoJogo);   // HISTÓRICO",
    "if (!sala.ia) historico.registarFim(sala.jogoId, sala.estadoDoJogo);   // HISTÓRICO")
sub("if (j.contaId && est && !est.abandonou)", "if (!sala.ia && j.contaId && est && !est.abandonou)")
sub("pagarFimDeJogo(sala);   // APOSTAS e bónus de vitória", "if (!sala.ia) pagarFimDeJogo(sala);   // APOSTAS e bónus de vitória")
sub("if (sala.estadoDoJogo && !sala.estadoDoJogo.jogoTerminado) {", "if (!sala.ia && sala.estadoDoJogo && !sala.estadoDoJogo.jogoTerminado) {")
bloco = open('bloco-ia.js', encoding='utf-8').read().replace('\r\n', '\n')
handler = open('handler-ia.js', encoding='utf-8').read().replace('\r\n', '\n')
sub("io.on('connection', (socket) => {", bloco + "\nio.on('connection', (socket) => {")
sub("// Cliente pede a lista de salas em espera (para mostrar no lobby)", handler.lstrip() + "\n  // Cliente pede a lista de salas em espera (para mostrar no lobby)")
sub("io.to(sala.id).emit('jogo:dadosRolados', { jogador: jogadorDoSocket.indice, dados });",
    "io.to(sala.id).emit('jogo:dadosRolados', { jogador: jogadorDoSocket.indice, dados });\n    agendarIA(sala, PAUSA_IA);")
sub("const resultado = moverPeca(estado, pecaId, destinoId);", "const resultado = moverPeca(estado, pecaId, destinoId);\n    agendarIA(sala, PAUSA_IA);")
sub("sala.decisoes[socket.id] = decisao;", "if (sala.ia) { decidirContraIA(sala, socket, decisao); return; }\n    sala.decisoes[socket.id] = decisao;")

shutil.copyfile('server.js', 'server.backup.js')
if crlf: s = s.replace('\n', '\r\n')
open('server.js', 'w', encoding='utf-8', newline='').write(s)
print('ok: 11 edicoes aplicadas. Copia de seguranca: server.backup.js')
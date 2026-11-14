import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversa } from '../src/conversa.js';

const H = 60 * 60 * 1000;
const PEDIDO = [
  '● Vou pausar a conversa da Barbearia Davi.',
  ' Bash command',
  '   /srv/jarvis-voz/bin/agir pausar osm:node/1',
  ' │ Permission rule Bash(/srv/jarvis-voz/bin/agir:*) requires confirmation for this command.',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
].join('\n');

function setup({ falhaVoz = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jp-conv-'));
  const respostaFile = join(dir, 'resposta.json');
  const clock = { t: 1_000_000 };
  const log = [];
  const tmux = {
    viva: true, tela_: '',
    async vivo() { return this.viva; },
    async iniciar() { log.push('iniciar'); this.viva = true; },
    async digitar(t) { log.push(['digitar', t]); },
    async tela() { return this.tela_; },
    async teclas(...k) { log.push(['teclas', ...k]); },
    async matar() { log.push('matar'); this.viva = false; },
  };
  let falas = 0;
  const falar = async () => { falas++; if (falhaVoz) throw new Error('kokoro fora'); return Buffer.from('RIFF'); };
  const c = createConversa({ tmux, respostaFile, falar, now: () => clock.t, esperaMax: 180000 });
  const responde = (texto) => writeFileSync(respostaFile, JSON.stringify({ texto, em: clock.t + 1 }));
  return { c, tmux, log, clock, responde, falas: () => falas };
}

test('sessão morta é iniciada antes de digitar', async () => {
  const { c, tmux, log } = setup();
  tmux.viva = false;
  await c.enviar('oi');
  assert.deepEqual(log, ['iniciar', ['digitar', 'oi']]);
});

test('segunda mensagem antes da resposta: ocupado, nada digitado', async () => {
  const { c, log } = setup();
  await c.enviar('oi');
  await assert.rejects(c.enviar('de novo'), /ainda está respondendo/);
  assert.equal(log.filter((l) => l[0] === 'digitar').length, 1);
});

test('texto vira uma linha só, literal, cortado em 2000', async () => {
  const { c, log, clock, responde } = setup();
  const { id } = await c.enviar('a\nb "c"; d');
  assert.deepEqual(log.at(-1), ['digitar', 'a b "c"; d']);
  clock.t += 10; responde('ok');
  await c.estado(id);
  await c.enviar('y'.repeat(2500));
  assert.equal(log.at(-1)[1].length, 2000);
  await assert.rejects(c.enviar('  \n '), /vazia/);
});

test('resposta gravada depois do envio: pronta, áudio gerado uma vez', async () => {
  const { c, clock, responde, falas } = setup();
  const { id } = await c.enviar('como está o bot?');
  assert.equal((await c.estado(id)).estado, 'pensando');
  clock.t += 5; responde('Tudo certo, senhor.');
  assert.deepEqual(await c.estado(id), { estado: 'pronta', texto: 'Tudo certo, senhor.', audio: true });
  await c.estado(id);
  assert.equal(falas(), 1);
  assert.ok(c.audio(id));
});

test('resposta antiga (antes do envio) não conta', async () => {
  const { c, clock, responde } = setup();
  responde('velha');
  clock.t += 100;
  const { id } = await c.enviar('oi');
  assert.equal((await c.estado(id)).estado, 'pensando');
});

test('voz falhou: pronta sem áudio', async () => {
  const { c, clock, responde } = setup({ falhaVoz: true });
  const { id } = await c.enviar('oi');
  clock.t += 5; responde('Olá.');
  assert.deepEqual(await c.estado(id), { estado: 'pronta', texto: 'Olá.', audio: false });
});

test('pedido de permissão na tela: aguardando_aprovacao com a ação', async () => {
  const { c, tmux } = setup();
  const { id } = await c.enviar('pausa a Barbearia Davi');
  tmux.tela_ = PEDIDO;
  assert.deepEqual(await c.estado(id), { estado: 'aguardando_aprovacao', acao: '/srv/jarvis-voz/bin/agir pausar osm:node/1', audio: false });
});

test('passado esperaMax: erro', async () => {
  const { c, clock } = setup();
  const { id } = await c.enviar('oi');
  clock.t += 180001;
  assert.equal((await c.estado(id)).estado, 'erro');
});

test('mais de 6 h sem uso: recomeça a sessão', async () => {
  const { c, clock, responde, log } = setup();
  const { id } = await c.enviar('oi');
  clock.t += 5; responde('Olá.');
  await c.estado(id);
  clock.t += 6 * H + 1;
  await c.enviar('voltei');
  assert.deepEqual(log.slice(-3), ['matar', 'iniciar', ['digitar', 'voltei']]);
});

test('responder: confere a tela antes de apertar', async () => {
  const { c, tmux, log } = setup();
  const { id } = await c.enviar('pausa');
  await assert.rejects(c.responder(id, true), /Não há pedido de aprovação/);
  tmux.tela_ = PEDIDO;
  await c.estado(id);
  tmux.tela_ = PEDIDO.replace('pausar osm:node/1', 'encerrar osm:node/1 perdido');
  await assert.rejects(c.responder(id, true), /O pedido mudou/);
  assert.ok(!log.some((l) => l[0] === 'teclas'));
  await c.responder(id, false);
  assert.deepEqual(log.at(-1), ['teclas', 'Escape']);
  tmux.tela_ = PEDIDO;
  await c.estado(id);
  await c.responder(id, true);
  assert.deepEqual(log.at(-1), ['teclas', '1']);
});

test('permissão para outra coisa: não deixa aprovar, só recusar', async () => {
  const { c, tmux, log } = setup();
  const { id } = await c.enviar('oi');
  tmux.tela_ = ' Bash command\n   rm -rf saida\n Do you want to proceed?\n ❯ 1. Yes';
  assert.equal((await c.estado(id)).acao, null);
  await assert.rejects(c.responder(id, true), /Só ações do Jarvis/);
  await c.responder(id, false);
  assert.deepEqual(log.at(-1), ['teclas', 'Escape']);
});

test('nova conversa mata a sessão e esquece a mensagem', async () => {
  const { c, log } = setup();
  const { id } = await c.enviar('oi');
  await c.nova();
  assert.equal(log.at(-1), 'matar');
  await assert.rejects(c.estado(id), /Mensagem não encontrada/);
  await c.enviar('de novo');
});

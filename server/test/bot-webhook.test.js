import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { handleWebhook, createBotRouter } from '../src/routes/bot.js';
import { sendAndRecord } from '../src/bot/engine.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/evolution/${name}.json`, import.meta.url)));

function setup(status = 'active') {
  const conv = { lead_id: 'L', phone: '5551991234567', phone_key: '5191234567', name: 'Aurora', status, reason: null, search_id: 's' };
  const log = { msgs: [], notes: [], disabled: [], sent: [] };
  const db = {
    botGetByPhoneKey: async (k) => (k === conv.phone_key ? { ...conv } : null),
    botGet: async () => ({ ...conv }),
    botSetLid: async (_, lid) => { conv.lid = lid; },
    botGetByLid: async (lid) => (lid === conv.lid ? { ...conv } : null),
    botIsOptedOut: async () => false,
    botMessageSource: async (id) => log.msgs.find((m) => m.id === id)?.source ?? null,
    botAddMessage: async (m) => { if (log.msgs.some((x) => x.id === m.id)) return false; log.msgs.push(m); return true; },
    botTransition: async (_, from, to, r = null) => {
      if (!from.includes(conv.status)) return false;
      conv.status = to; conv.reason = r;
      return true;
    },
    botMarkOptOut: async () => { conv.status = 'opted_out'; },
  };
  const deps = {
    db,
    gateway: { send: async (_, t) => { log.sent.push(t); return 'x'; } },
    notify: async (t) => log.notes.push(t),
    disableBot: async (reason) => log.disabled.push(reason),
  };
  return { conv, log, deps };
}

test('texto de lead sem nono dígito cai na conversa certa', async () => {
  const { log, deps } = setup();
  await handleWebhook(fixture('text'), deps);
  assert.deepEqual(log.msgs.map((m) => [m.id, m.source, m.body]), [['IN1', 'lead', 'quanto fica?']]);
});

test('o mesmo id duas vezes é processado uma vez', async () => {
  const { log, deps } = setup();
  await handleWebhook(fixture('text'), deps);
  await handleWebhook(fixture('text'), deps);
  assert.equal(log.msgs.length, 1);
});

test('grupo, status e contato sem conversa são ignorados', async () => {
  const { log, deps } = setup();
  await handleWebhook(fixture('group'), deps);
  const status = fixture('text');
  status.data.key.remoteJid = 'status@broadcast';
  await handleWebhook(status, deps);
  const stranger = fixture('text');
  stranger.data.key.remoteJid = '5521988887777@s.whatsapp.net';
  await handleWebhook(stranger, deps);
  assert.deepEqual([log.msgs, log.sent, log.notes], [[], [], []]);
});

test('identificador lid usa o número alternativo e depois é reconhecido sozinho', async () => {
  const { log, deps } = setup();
  await handleWebhook(fixture('lid'), deps);
  assert.equal(log.msgs.length, 1);
  const known = fixture('lid');
  known.data.key.id = 'L2';
  delete known.data.key.remoteJidAlt;
  await handleWebhook(known, deps);
  assert.equal(log.msgs.length, 2);
});

test('lid desconhecido sem número não vira conversa e só avisa', async () => {
  const { log, deps } = setup();
  const unknown = fixture('lid');
  delete unknown.data.key.remoteJidAlt;
  await handleWebhook(unknown, deps);
  assert.deepEqual([log.msgs, log.sent, log.disabled], [[], [], []]);
  assert.equal(log.notes.length, 1);
});

test('áudio de lead pausa a conversa', async () => {
  const { conv, deps } = setup();
  await handleWebhook(fixture('audio'), deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'media']);
});

test('reação e evento de protocolo não pausam nem contam como mensagem', async () => {
  const { conv, log, deps } = setup();
  for (const message of [{ reactionMessage: { text: '👍' } }, { protocolMessage: { type: 0 } }]) {
    const e = fixture('audio');
    e.data.message = message;
    await handleWebhook(e, deps);
  }
  assert.equal(conv.status, 'active');
  assert.equal(log.msgs.length, 0);
});

test('Lorenzo responde pelo celular: pausa com owner_replied', async () => {
  const { conv, log, deps } = setup();
  await handleWebhook(fixture('from-me'), deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'owner_replied']);
  assert.equal(log.msgs[0].source, 'owner');
});

test('eco do envio do bot não pausa', async () => {
  const { conv, deps, log } = setup();
  log.msgs.push({ id: 'OUT1', source: 'bot' });
  await handleWebhook(fixture('from-me'), deps);
  assert.equal(conv.status, 'active');
});

test('fromMe que chega durante o envio espera e não pausa', async () => {
  const { conv, deps, log } = setup();
  let release;
  deps.gateway.send = () => new Promise((resolve) => { release = () => resolve('OUT1'); });
  const sendDone = sendAndRecord(conv, 'oi', deps);
  await new Promise((r) => setImmediate(r));
  const hook = handleWebhook(fixture('from-me'), deps);
  await new Promise((r) => setImmediate(r));
  assert.equal(conv.status, 'active');
  release();
  await Promise.all([sendDone, hook]);
  assert.equal(conv.status, 'active');
  assert.deepEqual(log.msgs.map((m) => m.source), ['bot']);
});

test('conversa encerrada não muda com resposta de Lorenzo', async () => {
  const { conv, deps } = setup('closed');
  await handleWebhook(fixture('from-me'), deps);
  assert.equal(conv.status, 'closed');
});

test('número desconectado desliga o bot e avisa', async () => {
  const { log, deps } = setup();
  await handleWebhook(fixture('connection-close'), deps);
  assert.deepEqual(log.disabled, ['whatsapp_disconnected']);
});

test('reenvio depois de falha ainda pausa a resposta de Lorenzo', async () => {
  const { conv, log, deps } = setup();
  log.msgs.push({ id: 'OUT1', source: 'owner' });
  await handleWebhook(fixture('from-me'), deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'owner_replied']);
});

test('Lorenzo responde antes da primeira mensagem: conversa na fila também pausa', async () => {
  const { conv, deps } = setup('queued');
  await handleWebhook(fixture('from-me'), deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'owner_replied']);
});

test('resposta de Lorenzo durante um envio usa o estado atual', async () => {
  const { conv, deps } = setup('queued');
  let release;
  deps.gateway.send = () => new Promise((resolve) => { release = () => resolve('OUT9'); });
  const sendDone = sendAndRecord(conv, 'oi', deps);
  await new Promise((r) => setImmediate(r));
  const hook = handleWebhook(fixture('from-me'), deps);
  await new Promise((r) => setImmediate(r));
  conv.status = 'active';
  release();
  await Promise.all([sendDone, hook]);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'owner_replied']);
});

test('resposta de Lorenzo em @lid já visto pausa só aquela conversa', async () => {
  const { conv, log, deps } = setup();
  await handleWebhook(fixture('lid'), deps);
  assert.equal(conv.lid, '111122223333@lid');
  await handleWebhook(fixture('lid-from-me'), deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'owner_replied']);
  assert.deepEqual(log.disabled, []);
  assert.equal(log.msgs.at(-1).source, 'owner');
});

test('resposta de Lorenzo em @lid desconhecido desliga o bot por segurança', async () => {
  const { log, deps } = setup();
  await handleWebhook(fixture('lid-from-me'), deps);
  assert.deepEqual(log.disabled, ['owner_unresolved']);
});

test('reação em @lid desconhecido não desliga o bot', async () => {
  const { log, deps } = setup();
  const e = fixture('lid-from-me');
  e.data.message = { reactionMessage: { text: '👍' } };
  await handleWebhook(e, deps);
  assert.deepEqual(log.disabled, []);
});

test('segredo errado recebe 401', async (t) => {
  process.env.BOT_WEBHOOK_SECRET = 'segredo-certo';
  const { log, deps } = setup();
  const app = express();
  app.use(express.json());
  app.use(createBotRouter(deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
  const post = (s) => fetch(`http://127.0.0.1:${server.address().port}/api/bot/webhook/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture('text')) });
  assert.equal((await post('errado')).status, 401);
  assert.equal(log.msgs.length, 0);
  assert.equal((await post('segredo-certo')).status, 200);
  assert.equal(log.msgs.length, 1);
});

test('sem segredo configurado, o webhook recusa tudo', async (t) => {
  delete process.env.BOT_WEBHOOK_SECRET;
  const { deps } = setup();
  const app = express();
  app.use(express.json());
  app.use(createBotRouter(deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/bot/webhook/undefined`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401);
});

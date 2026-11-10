import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createBotRouter } from '../src/routes/bot.js';

process.env.BOT_WEBHOOK_SECRET = 's';

async function start(t, { status = 'paused', mode = 'simulate', connection = 'open', optedOut = false } = {}) {
  process.env.BOT_MODE = mode;
  const conv = { lead_id: 'osm:node/1', phone: '5551991234567', phone_key: '5191234567', name: 'Aurora', status, reason: 'manual', search_id: 's' };
  const log = { stages: [], saved: [], msgs: [], qr: 0 };
  const deps = {
    db: {
      botGet: async (id) => (id === conv.lead_id ? { ...conv } : null),
      botList: async () => [{ ...conv }],
      botHistory: async () => log.msgs,
      botTransition: async (_, from, to, r = null) => {
        if (!from.includes(conv.status)) return false;
        conv.status = to; conv.reason = r;
        return true;
      },
      botIsOptedOut: async () => optedOut,
      botMarkOptOut: async () => { conv.status = 'opted_out'; },
      botAddMessage: async (m) => { log.msgs.push(m); return true; },
      botClearAiFailure: async () => {},
      saveSetting: async (k, v) => log.saved.push([k, v]),
    },
    settings: async () => ({ botConfig: { enabled: false, cities: [] }, limits: { whatsapp: 5 }, usage: { date: '2020-01-01', whatsapp: 3 } }),
    gateway: { state: async () => connection, linkState: async () => connection, send: async () => 'x', connect: async () => { log.qr++; return { qr: 'data:image/png;base64,AAA' }; } },
    notify: async () => {},
    setStage: async (_, s) => log.stages.push(s),
    disableBot: async () => {},
  };
  const app = express();
  app.use(express.json());
  app.use(createBotRouter(deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = 'POST', body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const conversation = `/api/bot/conversations/${encodeURIComponent(conv.lead_id)}`;
  return { conv, log, call, conversation };
}

test('pausar, devolver e finalizar', async (t) => {
  const { conv, log, call, conversation } = await start(t, { status: 'active' });
  assert.equal((await call(`${conversation}/pause`)).status, 200);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'manual']);
  assert.equal((await call(`${conversation}/resume`)).status, 200);
  assert.deepEqual([conv.status, conv.reason], ['active', null]);
  assert.equal((await call(`${conversation}/finish`, 'POST', { won: true })).status, 200);
  assert.equal(conv.status, 'closed');
  assert.deepEqual(log.stages, ['ganho']);
});

test('finalizar sem venda vai para descartado e exige escolha', async (t) => {
  const { log, call, conversation } = await start(t);
  assert.equal((await call(`${conversation}/finish`, 'POST', {})).status, 400);
  assert.equal((await call(`${conversation}/finish`, 'POST', { won: false })).status, 200);
  assert.deepEqual(log.stages, ['descartado']);
});

for (const status of ['opted_out', 'closed']) {
  test(`devolver ao bot é recusado em ${status}`, async (t) => {
    const { call, conversation } = await start(t, { status });
    assert.equal((await call(`${conversation}/resume`)).status, 409);
  });
}

test('devolver ao bot é recusado para quem está na lista de saída', async (t) => {
  const { conv, call, conversation } = await start(t, { optedOut: true });
  assert.equal((await call(`${conversation}/resume`)).status, 409);
  assert.equal(conv.status, 'paused');
});

test('pausar também segura o envio em curso', async (t) => {
  const { conv, call, conversation } = await start(t, { status: 'sending' });
  assert.equal((await call(`${conversation}/pause`)).status, 200);
  assert.equal(conv.status, 'paused');
});

test('conversa inexistente retorna 404', async (t) => {
  const { call } = await start(t);
  assert.equal((await call('/api/bot/conversations/nada/pause')).status, 404);
});

test('ligar com o número desconectado em live é recusado', async (t) => {
  const { log, call } = await start(t, { mode: 'live', connection: 'close' });
  const r = await call('/api/bot/enabled', 'PUT', { enabled: true });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /desconectado/i);
  assert.equal(log.saved.length, 0);
});

test('ligar em simulação salva a configuração', async (t) => {
  const { log, call } = await start(t);
  assert.equal((await call('/api/bot/enabled', 'PUT', { enabled: true })).status, 200);
  assert.equal(log.saved[0][1].enabled, true);
});

test('simular resposta só existe fora de live', async (t) => {
  const live = await start(t, { mode: 'live' });
  assert.equal((await live.call('/api/bot/simulate-reply', 'POST', { leadId: live.conv.lead_id, text: 'oi' })).status, 404);
  const sim = await start(t, { status: 'active' });
  assert.equal((await sim.call('/api/bot/simulate-reply', 'POST', { leadId: sim.conv.lead_id, text: 'oi' })).status, 200);
  assert.equal(sim.log.msgs[0].source, 'lead');
});

test('configuração inválida é recusada', async (t) => {
  const { log, call } = await start(t);
  for (const body of [{ cities: 'x' }, { niches: [1] }, { radiusKm: 99 }, { sendFrom: '25:00' }, { cities: [{ name: 'a' }] }]) {
    assert.equal((await call('/api/bot/config', 'PUT', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(log.saved.length, 0);
  assert.equal((await call('/api/bot/config', 'PUT', { cities: [{ name: 'POA', lat: -30, lng: -51 }], niches: ['barbearia'], radiusKm: 5, sendFrom: '09:00', sendTo: '18:00', weekdaysOnly: true })).status, 200);
  // Cidade nova: salva a config e libera a captação no mesmo dia.
  assert.deepEqual(log.saved.map(([k]) => k), ['botConfig', 'botState']);
  assert.equal(log.saved[1][1].lastCaptureDate, null);
});

test('mudar só o horário não refaz a captação', async (t) => {
  const { log, call } = await start(t);
  assert.equal((await call('/api/bot/config', 'PUT', { cities: [], niches: [], radiusKm: 5, sendFrom: '10:00', sendTo: '18:00', weekdaysOnly: true })).status, 200);
  assert.deepEqual(log.saved.map(([k]) => k), ['botConfig']);
});

test('status zera contador de outro dia e informa o modo', async (t) => {
  const { call } = await start(t);
  const s = await (await call('/api/bot/status', 'GET')).json();
  assert.deepEqual([s.mode, s.connection, s.sentToday, s.dailyLimit], ['simulate', 'open', 0, 5]);
});

test('QR code para conectar', async (t) => {
  const { log, call } = await start(t, { mode: 'live', connection: 'close' });
  assert.equal((await (await call('/api/bot/connect')).json()).qr, 'data:image/png;base64,AAA');
  assert.equal(log.qr, 1);
});

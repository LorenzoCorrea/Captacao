import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptacao } from '../src/captacao.js';

const conv = (name, status, reason = null) => ({ lead_id: `id-${name}`, name, phone: '55', status, reason });

function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, init }); return handler(url, init); };
  return { fetch, calls };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('leads filtra status e põe quem pediu prévia no topo', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, { conversations: [
    conv('Carlos', 'closed'), conv('Dora', 'queued'), conv('Eva', 'opted_out'),
    conv('Bruno', 'active'), conv('Zélia', 'paused', 'preview_requested'), conv('Ana', 'paused', 'manual'),
  ] }));
  const c = createCaptacao({ url: 'http://c', auth: 'u:p', fetch });
  const leads = await c.leads();
  assert.deepEqual(leads.map((l) => l.name), ['Zélia', 'Ana', 'Bruno']);
  assert.deepEqual(leads[0], { leadId: 'id-Zélia', name: 'Zélia', phone: '55', pediuPrevia: true });
  assert.equal(calls[0].url, 'http://c/api/bot/conversations');
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('u:p').toString('base64')}`);
});

test('sendPreview devolve status e erro do Captação', async () => {
  const { fetch, calls } = fakeFetch(() => json(409, { error: 'x' }));
  const c = createCaptacao({ url: 'http://c', auth: 'u:p', fetch });
  assert.deepEqual(await c.sendPreview('osm:node/1', Buffer.from('%PDF'), 'previa.pdf'), { ok: false, status: 409, error: 'x' });
  assert.equal(calls[0].url, 'http://c/api/bot/conversations/osm%3Anode%2F1/preview?file=previa.pdf');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/pdf');
});

test('sendPreview ok', async () => {
  const { fetch } = fakeFetch(() => json(200, { ok: true, id: 'x' }));
  const c = createCaptacao({ url: 'http://c', auth: 'u:p', fetch });
  assert.deepEqual(await c.sendPreview('a', Buffer.from('%PDF'), 'previa.pdf'), { ok: true });
});

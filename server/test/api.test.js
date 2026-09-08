import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

delete process.env.DATABASE_URL;
process.env.ENRICH_BACKGROUND = 'false';
process.env.DATA_PROVIDER = 'mock';
const { default: router } = await import('../src/routes/search.js');

test('HTTP search, CRM update, reload and exports work together', async (t) => {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method, body) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await request('/api/search', 'POST', { niche: 123 })).status, 400);
  const response = await request('/api/search', 'POST', { niche: 'dentista' });
  assert.equal(response.status, 200);
  const search = await response.json();
  const lead = search.leads[0];
  const path = `/api/search/${search.searchId}`;
  const leadPath = `${path}/leads/${encodeURIComponent(lead.id)}`;
  assert.equal((await request(leadPath, 'PATCH', { stage: 'contatado', notes: 'Retornar amanhã' })).status, 200);
  assert.equal((await request(leadPath, 'PATCH', { stage: 'ganho', msgVariant: 'bad' })).status, 400);
  const loaded = await (await fetch(base + path + '/leads')).json();
  assert.equal(loaded.leads[0].stage, 'contatado');
  assert.equal(loaded.leads[0].notes, 'Retornar amanhã');
  const csv = await fetch(base + path + '/export?format=csv');
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /contatado/);
  const xlsx = await fetch(base + path + '/export?format=xlsx');
  assert.equal(xlsx.status, 200);
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.equal((await (await fetch(base + '/api/status')).json()).dbEnabled, false);
});

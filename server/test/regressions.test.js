import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.DATABASE_URL;
process.env.ENRICH_BACKGROUND = 'false';
process.env.DATA_PROVIDER = 'mock';
const { createSearch, updateLead, getSearchLeads } = await import('../src/enrichment/enricher.js');
const { default: router } = await import('../src/routes/search.js');
const searchHandler = router.stack.find((layer) => layer.route?.path === '/api/search').route.stack[0].handle;

test('invalid search input returns JSON 400 without throwing', async () => {
  for (const body of [{ niche: 42 }, { niche: {} }, { niche: 'dentista', city: {} },
    { niche: 'dentista', lat: null }, { niche: 'dentista', lng: '' },
    { niche: 'dentista', lat: [] }, { niche: 'dentista', lng: true }]) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
    await searchHandler({ body }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(typeof res.data.error, 'string');
  }
});

test('valid search accepts numeric strings and clamps the radius', async () => {
  const res = { status(code) { throw new Error(`Unexpected HTTP ${code}`); }, json(data) { this.data = data; } };
  await searchHandler({ body: { niche: ' dentista ', lat: '-30', lng: '-51', radiusKm: 100 } }, res);
  assert.equal(res.data.query.niche, 'dentista');
  assert.equal(res.data.query.lat, -30);
  assert.equal(res.data.query.radiusKm, 30);
  assert.ok(res.data.leads.length);
});

test('rejected CRM patch leaves every field unchanged', async () => {
  const sid = createSearch([{ id: 'osm:node/1', name: 'Clínica' }]);
  const before = structuredClone((await getSearchLeads(sid)).leads[0]);
  assert.equal(await updateLead(sid, before.id, { stage: 'ganho', notes: 'changed', msgVariant: 'invalid' }), false);
  assert.deepEqual((await getSearchLeads(sid)).leads[0], before);
  assert.equal(await updateLead(sid, before.id, { notes: 'Nota', msgVariant: 'A', stage: 'contatado' }), true);
  assert.equal((await getSearchLeads(sid)).leads[0].notes, 'Nota');
});

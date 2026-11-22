// Roda só com um banco descartável: TEST_DATABASE_URL=postgresql://... npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.ENRICH_BACKGROUND = 'false';

test('SQL real: lead único, configurações, contadores e base local', { skip: !url }, async () => {
  const db = await import('../src/db.js');
  const { createSearch, updateLead } = await import('../src/enrichment/enricher.js');
  const { buscarEstabelecimentos } = await import('../src/data/osmProvider.js');
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    assert.equal(await db.initDb(), true);
    await sql.query('TRUNCATE searches CASCADE; DELETE FROM app_settings; DROP TABLE IF EXISTS osm_places');

    // Sem base local: quem chama recorre ao Overpass.
    assert.equal(await db.buscarOsmLocal({ tags: ['shop'], nameRegex: '', lat: 0, lng: 0, radiusKm: 1 }), null);

    const lead = { id: 'osm:node/1', name: 'Salão Aurora', address: 'Rua A', phone: null, lat: -30, lng: -51, hasWebsite: false, source: 'osm', niche: 'salão' };
    const first = createSearch([lead], { city: 'POA', niche: 'salão', found: 1 });
    await updateLead(first, lead.id, { stage: 'contatado', notes: 'ligar', tags: ['quente'], estimatedValue: 500, followUpAt: '2020-01-01', interactions: [{ at: 'x', type: 'msg' }] });
    await new Promise((r) => setTimeout(r, 300));

    // A mesma empresa numa segunda busca chega com o estado da primeira.
    const known = await db.loadKnownLeads([lead.id, 'osm:node/404']);
    assert.equal(known.size, 1);
    assert.equal(known.get(lead.id).stage, 'contatado');
    const second = createSearch([lead], { city: 'POA', niche: 'beleza', found: 1 }, known);
    await new Promise((r) => setTimeout(r, 300));
    const copy = await db.loadSearch(second);
    assert.equal(copy.leads[0].notes, 'ligar');
    assert.deepEqual(copy.leads[0].tags, ['quente']);
    assert.equal(copy.leads[0].interactions.length, 1);

    // Alterar numa busca vale para as duas e não conta em dobro.
    await updateLead(second, lead.id, { stage: 'ganho' });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await db.loadSearch(first)).leads[0].stage, 'ganho');
    const stats = await db.statsConversao();
    assert.equal(stats.geral.total, 1);
    assert.equal(stats.geral.ganho, 1);
    assert.equal(stats.geral.buscas, 2);
    assert.equal(stats.geral.won_value, 500);

    await updateLead(second, lead.id, { stage: 'qualificado' });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await db.todayLeads()).length, 1);

    // Configurações e contador atômico.
    await db.saveSetting('limits', { whatsapp: 9 });
    await db.saveSetting('lastSearchId', crypto.randomUUID());
    assert.equal((await db.loadSettings()).limits.whatsapp, 9);
    const counts = await Promise.all(Array.from({ length: 5 }, () => db.incrementUsage('whatsapp', '2026-11-04', 111)));
    assert.equal(Math.max(...counts.map((c) => c.whatsapp)), 5);
    const nextDay = await db.incrementUsage('instagram', '2026-11-05', 222);
    assert.deepEqual([nextDay.date, nextDay.instagram, nextDay.whatsapp, nextDay.lastAt], ['2026-11-05', 1, undefined, 222]);

    // Base local: tag, nome sem acento, raio e fora do raio.
    await sql.query(`CREATE TABLE osm_places (id text PRIMARY KEY, lat float8, lng float8, name_norm text, tags text[], props jsonb)`);
    await sql.query(`INSERT INTO osm_places VALUES
      ('node/10', -30.00, -51.00, 'barbearia do ze', '{shop,shop=hairdresser}', '{"name":"Barbearia do Zé","phone":"51 3333-3333"}'),
      ('way/11', -30.01, -51.01, 'estetica bela', '{amenity,amenity=clinic}', '{"name":"Estética Bela","website":"https://bela.com"}'),
      ('node/12', -30.01, -51.01, 'oficina x', '{shop,shop=car_repair}', '{"name":"Oficina X"}'),
      ('node/13', -35.00, -55.00, 'barbearia longe', '{shop,shop=hairdresser}', '{"name":"Barbearia Longe"}')`);
    const r = await buscarEstabelecimentos({ niche: 'estética', city: 'POA', lat: -30, lng: -51, radiusKm: 5 });
    assert.equal(r.found, 2);
    assert.deepEqual(r.leads.map((l) => [l.id, l.name, l.phone]), [['osm:node/10', 'Barbearia do Zé', '51 3333-3333']]);
    const todos = await buscarEstabelecimentos({ niche: 'todos', city: 'POA', lat: -30, lng: -51, radiusKm: 5 });
    assert.equal(todos.found, 3);
  } finally {
    await sql.end();
  }
});

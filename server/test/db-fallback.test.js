import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

process.env.DATABASE_URL = 'postgresql://test:test@localhost/captacao_test';
let queries = 0;
pg.Pool.prototype.query = async () => { queries++; throw new Error('database unavailable'); };
pg.Pool.prototype.connect = async () => { throw new Error('fallback must not connect'); };
const db = await import('../src/db.js');

test('failed database startup disables persistence and keeps memory fallback', async () => {
  assert.equal(await db.initDb(), false);
  assert.equal(db.dbEnabled, false);
  assert.deepEqual(await db.listSearches(), []);
  assert.equal(await db.todayLeads(), null);
  assert.equal(await db.statsConversao(), null);
  assert.equal(await db.loadSearch('missing'), null);
  await db.saveSearch({});
  await db.saveEnrichment('missing', {});
  await db.saveLeadFields('missing', 'lead', { notes: 'test' });
  assert.equal(queries, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

process.env.DATABASE_URL = 'postgresql://test:test@localhost/captacao_test';
const queries = [];
pg.Pool.prototype.query = async (sql) => { queries.push(sql); return { rows: [{ id: 'saved-search' }] }; };
const db = await import('../src/db.js');

test('successful database startup enables persisted reads', async () => {
  assert.equal(db.dbEnabled, false);
  assert.equal(await db.initDb(), true);
  assert.equal(db.dbEnabled, true);
  assert.deepEqual(await db.listSearches(), [{ id: 'saved-search' }]);
  assert.equal(queries.length, 2);
});

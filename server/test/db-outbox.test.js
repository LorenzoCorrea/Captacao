import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

process.env.DATABASE_URL = 'postgresql://test:test@localhost/captacao_test';
let online = true;
const writes = [];
pg.Pool.prototype.query = async (sql, vals) => {
  if (!online) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  if (/^UPDATE/.test(sql)) writes.push(vals);
  return { rows: [] };
};
const db = await import('../src/db.js');

test('gravação feita com o banco fora é repetida quando ele volta', async () => {
  assert.equal(await db.initDb(), true);
  online = false;
  await db.saveLeadFields('s', 'a', { notes: 'primeira' });
  await db.saveLeadFields('s', 'b', { notes: 'segunda' });
  assert.equal(writes.length, 0);
  assert.equal(db.dbStatus().pendingWrites, 2);
  assert.equal(db.dbStatus().offline, true);

  await db.flushOutbox();
  assert.equal(db.dbStatus().pendingWrites, 2);

  online = true;
  await db.flushOutbox();
  assert.equal(db.dbStatus().pendingWrites, 0);
  assert.equal(db.dbStatus().offline, false);
  assert.deepEqual(writes.map((v) => v[0]), ['primeira', 'segunda']);
});

test('erro que não é de conexão não trava a fila', async () => {
  pg.Pool.prototype.query = async () => { throw Object.assign(new Error('bad value'), { code: '22P02' }); };
  await db.saveLeadFields('s', 'c', { notes: 'x' });
  assert.equal(db.dbStatus().pendingWrites, 0);
});

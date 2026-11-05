import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

test('dados do bot no Postgres real', { skip: !url }, async () => {
  const db = await import('../src/db.js');
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    assert.equal(await db.initDb(), true);
    await sql.query('TRUNCATE bot_conversations, bot_messages, bot_optouts');
    const conv = { leadId: 'osm:node/1', phone: '5551991234567', phoneKey: '5191234567', name: 'Studio Aurora', niche: 'salão' };

    assert.equal(await db.botEnqueue(conv), true);
    assert.equal(await db.botEnqueue(conv), false, 'repetido');
    assert.equal((await db.botNextQueued()).lead_id, conv.leadId);

    await db.botOptOut('5100000000');
    assert.equal(await db.botEnqueue({ ...conv, leadId: 'osm:node/2', phoneKey: '5100000000' }), false, 'optout');

    assert.equal(await db.botAddMessage({ id: 'm1', leadId: conv.leadId, direction: 'out', source: 'bot', body: 'oi' }), true);
    assert.equal(await db.botAddMessage({ id: 'm1', leadId: conv.leadId, direction: 'out', source: 'bot', body: 'oi' }), false, 'id repetido');

    await db.botSetStatus(conv.leadId, 'active');
    assert.equal((await db.botDueReplies(0)).length, 0, 'última é do bot');
    await db.botAddMessage({ id: 'm2', leadId: conv.leadId, direction: 'in', source: 'lead', body: 'quanto?' });
    assert.equal((await db.botDueReplies(3600)).length, 0, 'ainda dentro da espera');
    assert.equal((await db.botDueReplies(0)).length, 1);
    assert.deepEqual((await db.botHistory(conv.leadId)).map((m) => m.id), ['m1', 'm2']);

    const first = new Date(Date.now() - 1000);
    await db.botSetAiFailure(conv.leadId, first, new Date(Date.now() + 300000));
    assert.equal((await db.botDueReplies(0)).length, 0, 'aguardando nova tentativa');
    await db.botClearAiFailure(conv.leadId);
    assert.equal((await db.botDueReplies(0)).length, 1);
    assert.equal(await db.botIncrementTurn(conv.leadId), 1);

    await db.botSetStatus(conv.leadId, 'paused', 'owner_replied');
    const paused = await db.botGet(conv.leadId);
    assert.deepEqual([paused.status, paused.reason], ['paused', 'owner_replied']);
    assert.equal((await db.botDueReplies(0)).length, 0, 'pausada não responde');
    assert.equal((await db.botGetByPhoneKey(conv.phoneKey)).lead_id, conv.leadId);
    assert.equal((await db.botList()).length, 1);

    await sql.query('TRUNCATE searches CASCADE');
    assert.equal(await db.botEnqueue({ ...conv, leadId: 'osm:node/3', phoneKey: '5100000000' }), false, 'optout sobrevive');
  } finally {
    await sql.end();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFerramentas, SERVICOS } from '../src/ferramentas.js';

const CONVERSAS = [
  { lead_id: 'osm:node/1', name: 'Barbearia Davi', status: 'paused', reason: 'preview_requested' },
  { lead_id: 'osm:node/2', name: 'Academia Evolução', status: 'active', reason: null },
];

function setup({ falhar } = {}) {
  const chamadas = [];
  const logs = [];
  const reinicios = [];
  const captacao = {
    async api(method, path, body) {
      chamadas.push({ method, path, body });
      if (falhar && method !== 'GET') throw new Error(falhar);
      if (path === '/api/bot/conversations') return { conversations: CONVERSAS };
      if (path === '/api/bot/status') return { mode: 'live', config: { enabled: true }, connection: 'open', sentToday: 2, dailyLimit: 5 };
      return { ok: true };
    },
  };
  const store = { list: () => [{ id: 'abcd1234', leadName: 'Barbearia Davi', estado: 'montando' }] };
  const sistema = { servicos: async () => ({ 'jarvis-previas': 'active' }), reiniciar: async (n) => { reinicios.push(n); } };
  const previas = { apagar: async (id) => { chamadas.push({ method: 'APAGAR', path: id }); } };
  const f = createFerramentas({ captacao, store, sistema, previas, log: (l) => logs.push(l) });
  return { f, chamadas, logs, reinicios };
}

test('consultar conversas paused lista só as pausadas, com lead_id', async () => {
  const { f } = setup();
  const r = await f.consultar('conversas', ['paused']);
  assert.match(r, /Barbearia Davi · osm:node\/1 · paused · preview_requested/);
  assert.doesNotMatch(r, /Academia/);
});

test('consultar bot resume o estado', async () => {
  const { f } = setup();
  assert.match(await f.consultar('bot', []), /ligado.*conectado.*2 de 5/s);
});

test('consultar assunto desconhecido', async () => {
  const { f } = setup();
  await assert.rejects(f.consultar('xyz', []), /Assunto desconhecido: xyz/);
});

test('agir pausar chama o Captação e grava o log', async () => {
  const { f, chamadas, logs } = setup();
  await f.agir('pausar', ['osm:node/1']);
  assert.ok(chamadas.some((c) => c.method === 'POST' && c.path === '/api/bot/conversations/osm%3Anode%2F1/pause'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].ok, true);
  assert.deepEqual([logs[0].acao, logs[0].args], ['pausar', ['osm:node/1']]);
});

test('agir pausar com lead inexistente não faz POST', async () => {
  const { f, chamadas } = setup();
  await assert.rejects(f.agir('pausar', ['osm:node/999']), /Lead não encontrado/);
  assert.ok(!chamadas.some((c) => c.method !== 'GET'));
});

test('agir reiniciar fora da lista não reinicia', async () => {
  const { f, reinicios } = setup();
  await assert.rejects(f.agir('reiniciar', ['postgres-db']), /Serviço fora da lista/);
  assert.deepEqual(reinicios, []);
  await f.agir('reiniciar', ['habblaud']);
  assert.deepEqual(reinicios, ['habblaud']);
  assert.ok(SERVICOS.includes('captacao-api-1'));
});

test('agir encerrar exige ganho ou perdido', async () => {
  const { f, chamadas } = setup();
  await assert.rejects(f.agir('encerrar', ['osm:node/1', 'talvez']), /Use ganho ou perdido/);
  await f.agir('encerrar', ['osm:node/1', 'perdido']);
  assert.deepEqual(chamadas.at(-1).body, { won: false });
});

test('agir apagar-pedido valida o id', async () => {
  const { f, chamadas } = setup();
  await assert.rejects(f.agir('apagar-pedido', ['../x']), /Pedido inválido/);
  await f.agir('apagar-pedido', ['abcd1234']);
  assert.deepEqual(chamadas.at(-1), { method: 'APAGAR', path: 'abcd1234' });
});

test('agir bot ligar/desligar', async () => {
  const { f, chamadas } = setup();
  await f.agir('bot', ['desligar']);
  assert.deepEqual(chamadas.at(-1), { method: 'PUT', path: '/api/bot/enabled', body: { enabled: false } });
  await assert.rejects(f.agir('bot', ['talvez']), /Use ligar ou desligar/);
});

test('ação desconhecida não é registrada como feita', async () => {
  const { f, logs } = setup();
  await assert.rejects(f.agir('formatar', []), /Ação desconhecida: formatar/);
  assert.equal(logs.length, 0);
});

test('falha do Captação vira ok:false no log e sobe o erro', async () => {
  const { f, logs } = setup({ falhar: 'Esta conversa não pode ser pausada.' });
  await assert.rejects(f.agir('pausar', ['osm:node/1']), /não pode ser pausada/);
  assert.equal(logs[0].ok, false);
  assert.match(logs[0].saida, /não pode ser pausada/);
});

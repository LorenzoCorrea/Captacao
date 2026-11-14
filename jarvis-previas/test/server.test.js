import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { createServer } from '../src/server.js';
import { ConversaError } from '../src/conversa.js';

const TOKEN = 'segredo-de-teste';
const LEADS = [{ leadId: 'osm:node/1', name: 'Aurora', phone: '5551991234567', pediuPrevia: true }];

async function start(t) {
  const root = mkdtempSync(join(tmpdir(), 'jp-srv-'));
  const jobsDir = join(root, 'jobs');
  const store = createStore(join(root, 'data'));
  const runner = { kicks: 0, stopped: [], kick() { this.kicks++; }, stop(id) { this.stopped.push(id); } };
  const captacao = { leads: async () => LEADS };
  const conversa = {
    ocupado: false, respondidas: [], novas: 0,
    async enviar(texto) { if (!texto?.trim()) throw new ConversaError(400, 'Mensagem vazia.'); if (this.ocupado) throw new ConversaError(409, 'O Jarvis ainda está respondendo.'); return { id: 'm1' }; },
    async estado(id) { if (id !== 'm1') throw new ConversaError(404, 'Mensagem não encontrada.'); return { estado: 'pronta', texto: 'Olá, senhor.', audio: true }; },
    audio: (id) => (id === 'm1' ? Buffer.from('RIFFwav') : undefined),
    async responder(id, aprovar) { this.respondidas.push([id, aprovar]); },
    async nova() { this.novas++; },
  };
  const server = createServer({ store, captacao, runner, jobsDir, token: TOKEN, conversa });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, type, auth = true } = {}) => fetch(base + path, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(type ? { 'Content-Type': type } : {}) },
    body,
  });
  const novo = async () => (await (await call('/pedidos', { method: 'POST', type: 'application/json', body: JSON.stringify({ leadId: 'osm:node/1', observacao: 'tons de verde' }) })).json()).id;
  return { call, novo, store, runner, jobsDir, conversa };
}

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test('sem token: 401', async (t) => {
  const { call } = await start(t);
  assert.equal((await call('/leads', { auth: false })).status, 401);
  assert.equal((await call('/pedidos', { auth: false })).status, 401);
});

test('leads devolve a lista do Captação', async (t) => {
  const { call } = await start(t);
  assert.deepEqual(await (await call('/leads')).json(), { leads: LEADS });
});

test('fluxo: cria, manda 2 fotos, inicia', async (t) => {
  const { call, novo, store, runner, jobsDir } = await start(t);
  const id = await novo();
  assert.equal(store.get(id).estado, 'recebendo');
  assert.deepEqual(JSON.parse(readFileSync(join(jobsDir, id, 'lead.json'), 'utf8')), { nome: 'Aurora', telefone: '5551991234567', observacao: 'tons de verde' });
  assert.equal((await call(`/pedidos/${id}/fotos`, { method: 'POST', type: 'image/jpeg', body: JPG })).status, 201);
  const r = await call(`/pedidos/${id}/fotos`, { method: 'POST', type: 'image/png', body: PNG });
  assert.deepEqual([r.status, (await r.json()).fotos], [201, 2]);
  assert.ok(existsSync(join(jobsDir, id, 'fotos', '01.jpg')));
  assert.ok(existsSync(join(jobsDir, id, 'fotos', '02.png')));
  assert.equal((await call(`/pedidos/${id}/iniciar`, { method: 'POST' })).status, 200);
  assert.equal(store.get(id).estado, 'na_fila');
  assert.equal(runner.kicks, 1);
  assert.equal((await call(`/pedidos/${id}/fotos`, { method: 'POST', type: 'image/jpeg', body: JPG })).status, 409);
  const { pedidos } = await (await call('/pedidos')).json();
  assert.deepEqual(pedidos.map((p) => [p.id, p.estado, p.leadName]), [[id, 'na_fila', 'Aurora']]);
});

test('foto HEIC: 415; foto de 16 MB: 413', async (t) => {
  const { call, novo } = await start(t);
  const id = await novo();
  assert.equal((await call(`/pedidos/${id}/fotos`, { method: 'POST', type: 'image/heic', body: JPG })).status, 415);
  assert.equal((await call(`/pedidos/${id}/fotos`, { method: 'POST', type: 'image/jpeg', body: Buffer.alloc(16 * 1024 * 1024) })).status, 413);
});

test('lead fora da lista: 400', async (t) => {
  const { call } = await start(t);
  const r = await call('/pedidos', { method: 'POST', type: 'application/json', body: JSON.stringify({ leadId: 'outro' }) });
  assert.equal(r.status, 400);
});

test('iniciar sem fotos: 400', async (t) => {
  const { call, novo } = await start(t);
  const id = await novo();
  assert.equal((await call(`/pedidos/${id}/iniciar`, { method: 'POST' })).status, 400);
});

test('id com ../ ou maiúsculas: 404', async (t) => {
  const { call } = await start(t);
  assert.equal((await call('/pedidos/..%2F..%2Fetc/previa.pdf')).status, 404);
  assert.equal((await call('/pedidos/ABCDEFGH/previa.pdf')).status, 404);
  assert.equal((await call('/pedidos/abcdefgh/previa.pdf')).status, 404);
});

test('previa.pdf servido quando existe; cancelar para o runner', async (t) => {
  const { call, novo, store, runner, jobsDir } = await start(t);
  const id = await novo();
  mkdirSync(join(jobsDir, id, 'saida'), { recursive: true });
  writeFileSync(join(jobsDir, id, 'saida', 'previa.pdf'), '%PDF-teste');
  const r = await call(`/pedidos/${id}/previa.pdf`);
  assert.deepEqual([r.status, r.headers.get('content-type'), await r.text()], [200, 'application/pdf', '%PDF-teste']);
  assert.equal((await call(`/pedidos/${id}/cancelar`, { method: 'POST' })).status, 200);
  assert.deepEqual(runner.stopped, [id]);
  assert.equal(store.get(id).estado, 'encerrado');
});

test('apagar: para a sessão, remove a pasta e some da lista', async (t) => {
  const { call, novo, store, runner, jobsDir } = await start(t);
  const id = await novo();
  assert.equal((await call(`/pedidos/${id}/apagar`, { method: 'POST' })).status, 200);
  assert.deepEqual(runner.stopped, [id]);
  assert.equal(existsSync(join(jobsDir, id)), false);
  assert.equal(store.get(id), undefined);
  assert.equal((await call(`/pedidos/${id}/apagar`, { method: 'POST' })).status, 404);
});

test('jarvis: mensagens exigem token, texto e uma por vez', async (t) => {
  const { call, conversa } = await start(t);
  const msg = (texto) => call('/jarvis/mensagens', { method: 'POST', type: 'application/json', body: JSON.stringify({ texto }) });
  assert.equal((await call('/jarvis/mensagens', { method: 'POST', auth: false })).status, 401);
  assert.equal((await msg('')).status, 400);
  const r = await msg('como está o bot?');
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { id: 'm1' });
  conversa.ocupado = true;
  const o = await msg('de novo');
  assert.equal(o.status, 409);
  assert.equal((await o.json()).error, 'O Jarvis ainda está respondendo.');
});

test('jarvis: estado, áudio, aprovação e nova conversa', async (t) => {
  const { call, conversa } = await start(t);
  assert.deepEqual(await (await call('/jarvis/mensagens/m1')).json(), { estado: 'pronta', texto: 'Olá, senhor.', audio: true });
  assert.equal((await call('/jarvis/mensagens/zz')).status, 404);
  const a = await call('/jarvis/mensagens/m1/audio');
  assert.equal(a.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await a.arrayBuffer()).toString(), 'RIFFwav');
  assert.equal((await call('/jarvis/mensagens/zz/audio')).status, 404);
  assert.equal((await call('/jarvis/mensagens/m1/aprovacao', { method: 'POST', type: 'application/json', body: '{"aprovar":"sim"}' })).status, 400);
  assert.equal((await call('/jarvis/mensagens/m1/aprovacao', { method: 'POST', type: 'application/json', body: '{"aprovar":true}' })).status, 200);
  assert.deepEqual(conversa.respondidas, [['m1', true]]);
  assert.equal((await call('/jarvis/nova', { method: 'POST' })).status, 200);
  assert.equal(conversa.novas, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { enviar } from '../src/enviar.js';

function setup(resposta = { ok: true }) {
  const root = mkdtempSync(join(tmpdir(), 'jp-env-'));
  const jobsDir = join(root, 'jobs');
  const store = createStore(join(root, 'data'));
  const enviados = [];
  const captacao = { async sendPreview(leadId, pdf, fileName) { enviados.push({ leadId, pdf: pdf.toString(), fileName }); return resposta; } };
  const p = store.create({ leadId: 'osm:node/1', leadName: 'Clínica Sorriso Feliz', phone: '55', observacao: '' });
  mkdirSync(join(jobsDir, p.id, 'saida'), { recursive: true });
  store.update(p.id, { estado: 'previa_pronta' });
  const pdf = (texto) => writeFileSync(join(jobsDir, p.id, 'saida', 'previa.pdf'), texto);
  pdf('%PDF-v1');
  return { id: p.id, store, captacao, jobsDir, enviados, pdf, run: (id = p.id) => enviar({ id, store, captacao, jobsDir }) };
}

test('id inválido ou com ../ é recusado sem tocar no disco', async () => {
  const { run, enviados } = setup();
  for (const id of ['../../etc', 'ABCDEFGH', 'abc', 'zzzzzzzz']) assert.equal((await run(id)).ok, false);
  assert.deepEqual(enviados, []);
});

test('usa o lead do registro, mesmo se lead.json foi alterado', async () => {
  const { id, run, enviados, jobsDir, store } = setup();
  writeFileSync(join(jobsDir, id, 'lead.json'), JSON.stringify({ leadId: 'outro-lead', telefone: '99' }));
  assert.deepEqual(await run(), { ok: true });
  assert.equal(enviados[0].leadId, 'osm:node/1');
  assert.equal(enviados[0].fileName, 'Previa-Clinica-Sorriso-Feliz.pdf');
  assert.equal(store.get(id).estado, 'enviado');
  assert.ok(store.get(id).enviadoEm);
});

test('mesmo PDF duas vezes: segunda recusada', async () => {
  const { run, enviados } = setup();
  assert.equal((await run()).ok, true);
  assert.deepEqual(await run(), { ok: false, motivo: 'esta prévia já foi enviada' });
  assert.equal(enviados.length, 1);
});

test('PDF alterado depois do envio: envia de novo', async () => {
  const { run, enviados, pdf } = setup();
  await run();
  pdf('%PDF-v2');
  assert.equal((await run()).ok, true);
  assert.deepEqual(enviados.map((e) => e.pdf), ['%PDF-v1', '%PDF-v2']);
});

test('409 do Captação vira estado erro com a mensagem', async () => {
  const { id, run, store } = setup({ ok: false, status: 409, error: 'O lead saiu da conversa.' });
  assert.deepEqual(await run(), { ok: false, motivo: 'O lead saiu da conversa.' });
  assert.deepEqual([store.get(id).estado, store.get(id).erro], ['erro', 'O lead saiu da conversa.']);
});

test('falha temporária do Captação não muda o estado', async () => {
  const { id, run, store } = setup({ ok: false, status: 503, error: 'fora do ar' });
  assert.equal((await run()).ok, false);
  assert.equal(store.get(id).estado, 'previa_pronta');
});

test('sem PDF ou pedido encerrado: recusa', async () => {
  const a = setup();
  a.store.update(a.id, { estado: 'encerrado' });
  assert.equal((await a.run()).ok, false);
  const b = setup();
  b.pdf('');
  assert.equal((await b.run()).ok, false);
  assert.deepEqual(b.enviados, []);
});

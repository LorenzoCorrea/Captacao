import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { createAuto } from '../src/auto.js';

const H = 60 * 60 * 1000;
const D = 24 * H;

function setup({ leads, photo = async () => ({ buffer: Buffer.from('img'), type: 'image/jpeg' }) } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jp-auto-'));
  const jobsDir = join(root, 'jobs');
  const clock = { t: 100 * D };
  const now = () => clock.t;
  const store = createStore(join(root, 'data'), { now });
  const avisos = [];
  const lead = { leadId: 'osm:node/1', name: 'Clínica Sorriso', phone: '5555999990000', pediuPrevia: true, niche: 'dentista', address: 'Rua A, 10', city: 'Santa Maria', pausadoEm: clock.t - H };
  const captacao = {
    leads: leads ?? (async () => [lead]),
    photo,
    previewReady: async (id) => { avisos.push(id); },
  };
  const auto = createAuto({ store, captacao, jobsDir, now });
  return { store, auto, clock, jobsDir, avisos, lead };
}

test('cria pedido para quem pediu prévia há pouco e coloca na fila', async () => {
  const { store, auto, jobsDir } = setup();
  await auto.passo();
  const [p] = store.list();
  assert.equal(p.estado, 'na_fila');
  assert.equal(p.automatico, true);
  assert.equal(p.fotos, 1);
  assert.equal(p.leadId, 'osm:node/1');
  assert.ok(existsSync(join(jobsDir, p.id, 'fotos', '01.jpg')));
  const lead = JSON.parse(readFileSync(join(jobsDir, p.id, 'lead.json'), 'utf8'));
  assert.equal(lead.ramo, 'dentista');
  assert.equal(lead.cidade, 'Santa Maria');
  assert.equal(lead.endereco, 'Rua A, 10');
  assert.match(lead.observacao, /^Pedido automático/);
});

test('ignora pedido de prévia com mais de 48 h e quem não pediu prévia', async () => {
  const velho = setup();
  velho.lead.pausadoEm = velho.clock.t - 49 * H;
  await velho.auto.passo();
  assert.equal(velho.store.list().length, 0);
  const semPedido = setup();
  semPedido.lead.pediuPrevia = false;
  await semPedido.auto.passo();
  assert.equal(semPedido.store.list().length, 0);
});

test('não duplica: pedido em aberto ou enviado há menos de 30 dias', async () => {
  const { store, auto, clock, lead } = setup();
  await auto.passo();
  await auto.passo();
  assert.equal(store.list().length, 1);
  const [p] = store.list();
  store.update(p.id, { estado: 'enviado', enviadoEm: clock.t });
  clock.t += 10 * D;
  lead.pausadoEm = clock.t - H;
  await auto.passo();
  assert.equal(store.list().length, 1);
  clock.t += 21 * D;
  lead.pausadoEm = clock.t - H;
  await auto.passo();
  assert.equal(store.list().length, 2);
});

test('sem foto de perfil, segue sem foto', async () => {
  const { store, auto } = setup({ photo: async () => null });
  await auto.passo();
  const [p] = store.list();
  assert.deepEqual([p.estado, p.fotos], ['na_fila', 0]);
});

test('erro ao buscar a foto não impede o pedido', async () => {
  const { store, auto } = setup({ photo: async () => { throw new Error('Evolution fora'); } });
  await auto.passo();
  const [p] = store.list();
  assert.deepEqual([p.estado, p.fotos], ['na_fila', 0]);
});

test('avisa uma vez quando o agente pede a aprovação', async () => {
  const { store, auto, avisos } = setup({ leads: async () => [] });
  const p = store.create({ leadId: 'x', leadName: 'X', phone: '1' });
  store.update(p.id, { estado: 'previa_pronta', aguardandoAprovacao: true });
  await auto.passo();
  await auto.passo();
  assert.deepEqual(avisos, ['x']);
  assert.ok(store.get(p.id).avisadoEm);
});

test('Captação fora do ar não lança erro', async () => {
  const { auto } = setup({ leads: async () => { throw new Error('ECONNREFUSED'); } });
  await auto.passo();
});

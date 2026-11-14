import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';

const H = 60 * 60 * 1000;

function setup({ max = 2 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jp-run-'));
  const jobsDir = join(root, 'jobs');
  const agentDir = join(root, 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'CLAUDE.md'), '# guia');
  const clock = { t: 1_000_000 };
  const now = () => clock.t;
  const store = createStore(join(root, 'data'), { now });
  const vivas = new Set();
  const tmux = {
    started: [], killed: [],
    async start(name, cwd, prompt) { this.started.push({ name, cwd, prompt }); vivas.add(name); },
    async alive(name) { return vivas.has(name); },
    async kill(name) { this.killed.push(name); vivas.delete(name); },
  };
  const runner = createRunner({ store, jobsDir, agentDir, tmux, now, max });
  const fila = () => {
    const p = store.create({ leadId: 'l', leadName: 'L', phone: '1', observacao: '' });
    mkdirSync(join(jobsDir, p.id, 'fotos'), { recursive: true });
    store.update(p.id, { estado: 'na_fila', fotos: 1 });
    clock.t += 1;
    return p.id;
  };
  return { store, runner, tmux, vivas, clock, jobsDir, fila };
}

test('nunca passa de 2 sessões', async () => {
  const { store, runner, tmux, jobsDir, fila } = setup();
  const [a, b, c] = [fila(), fila(), fila()];
  await runner.tick();
  assert.deepEqual([a, b, c].map((id) => store.get(id).estado), ['montando', 'montando', 'na_fila']);
  assert.deepEqual(tmux.started.map((s) => s.name), [`previa-${a}`, `previa-${b}`]);
  assert.equal(tmux.started[0].cwd, join(jobsDir, a));
  assert.match(tmux.started[0].prompt, /CLAUDE\.md/);
  assert.equal(readFileSync(join(jobsDir, a, 'CLAUDE.md'), 'utf8'), '# guia');
  assert.ok(existsSync(join(jobsDir, a, 'saida')));
});

test('PDF gerado vira previa_pronta', async () => {
  const { store, runner, jobsDir, fila } = setup();
  const id = fila();
  await runner.tick();
  writeFileSync(join(jobsDir, id, 'saida', 'previa.pdf'), '%PDF');
  await runner.tick();
  assert.equal(store.get(id).estado, 'previa_pronta');
});

test('sessão morta vira encerrado e libera a vaga', async () => {
  const { store, runner, vivas, fila } = setup({ max: 1 });
  const [a, b] = [fila(), fila()];
  await runner.tick();
  vivas.delete(`previa-${a}`);
  await runner.tick();
  assert.deepEqual([store.get(a).estado, store.get(b).estado], ['encerrado', 'montando']);
});

test('6 h montando: kill e erro tempo esgotado', async () => {
  const { store, runner, tmux, clock, fila } = setup();
  const id = fila();
  await runner.tick();
  clock.t += 6 * H + 1;
  await runner.tick();
  assert.deepEqual(tmux.killed, [`previa-${id}`]);
  assert.deepEqual([store.get(id).estado, store.get(id).erro], ['encerrado', 'tempo esgotado']);
});

test('enviado: kill depois de 60 s', async () => {
  const { store, runner, tmux, clock, fila } = setup();
  const id = fila();
  await runner.tick();
  store.update(id, { estado: 'enviado', enviadoEm: clock.t });
  clock.t += 30_000;
  await runner.tick();
  assert.deepEqual(tmux.killed, []);
  clock.t += 31_000;
  await runner.tick();
  assert.deepEqual(tmux.killed, [`previa-${id}`]);
  assert.equal(store.get(id).estado, 'enviado');
});

test('apaga pedidos com mais de 30 dias', async () => {
  const { store, runner, clock, jobsDir, fila } = setup();
  const id = fila();
  store.update(id, { estado: 'enviado', enviadoEm: clock.t });
  clock.t += 31 * 24 * H;
  await runner.tick();
  assert.equal(existsSync(join(jobsDir, id)), false);
  assert.equal(store.get(id).apagado, true);
});

test('stop mata a sessão do pedido', async () => {
  const { runner, tmux, fila } = setup();
  const id = fila();
  await runner.tick();
  await runner.stop(id);
  assert.deepEqual(tmux.killed, [`previa-${id}`]);
});

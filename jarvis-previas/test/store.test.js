import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';

const dir = () => mkdtempSync(join(tmpdir(), 'jp-store-'));

test('create gera id de 8 chars e estado recebendo', () => {
  const store = createStore(dir());
  const p = store.create({ leadId: 'osm:node/1', leadName: 'Aurora', phone: '5551', observacao: '' });
  assert.match(p.id, /^[a-z0-9]{8}$/);
  assert.equal(p.estado, 'recebendo');
  assert.equal(p.fotos, 0);
  assert.equal(store.get(p.id).leadName, 'Aurora');
});

test('update persiste entre instâncias', () => {
  const d = dir();
  const a = createStore(d);
  const p = a.create({ leadId: 'x', leadName: 'X', phone: '1', observacao: 'verde' });
  a.update(p.id, { estado: 'na_fila', fotos: 2 });
  const b = createStore(d);
  assert.deepEqual([b.get(p.id).estado, b.get(p.id).fotos, b.get(p.id).observacao], ['na_fila', 2, 'verde']);
});

test('list traz os mais recentes primeiro', () => {
  let t = 1000;
  const store = createStore(dir(), { now: () => t++ });
  const a = store.create({ leadId: 'a', leadName: 'A', phone: '1', observacao: '' });
  const b = store.create({ leadId: 'b', leadName: 'B', phone: '2', observacao: '' });
  assert.deepEqual(store.list().map((p) => p.id), [b.id, a.id]);
});

test('get de id inexistente: undefined; update de inexistente lança', () => {
  const store = createStore(dir());
  assert.equal(store.get('zzzzzzzz'), undefined);
  assert.throws(() => store.update('zzzzzzzz', { estado: 'erro' }));
});

test('dois processos: um não apaga a mudança do outro', () => {
  const d = dir();
  const servico = createStore(d);
  const p = servico.create({ leadId: 'x', leadName: 'X', phone: '1', observacao: '' });
  createStore(d).update(p.id, { estado: 'enviado' });
  servico.update(p.id, { fotos: 3 });
  assert.deepEqual([createStore(d).get(p.id).estado, createStore(d).get(p.id).fotos], ['enviado', 3]);
});

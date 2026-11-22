import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNiche } from '../src/data/osmProvider.js';

test('fisioterapia não puxa psicólogos (o "terapia" do meio da palavra não conta)', () => {
  const { tags, kws } = resolveNiche('fisioterapia');
  assert.ok(tags.includes('healthcare=physiotherapist'));
  assert.ok(!tags.includes('healthcare=psychotherapist'));
  assert.deepEqual(kws, ['fisio']);
});

test('nichos continuam casando pelo começo das palavras', () => {
  assert.ok(resolveNiche('psicólogo').tags.includes('healthcare=psychotherapist'));
  assert.ok(resolveNiche('terapia holística').tags.includes('healthcare=psychotherapist'));
  assert.ok(resolveNiche('clínica de estética').tags.includes('shop=beauty'));
  assert.ok(resolveNiche('clínica odontológica').tags.includes('amenity=dentist'));
  assert.ok(resolveNiche('hamburgueria').tags.includes('amenity=fast_food'));
});

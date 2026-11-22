import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileFromLead, phoneKey } from '../src/bot/phone.js';

test('aceita celular em vários formatos', () => {
  for (const raw of ['(51) 99123-4567', '+55 51 99123-4567', '051 99123 4567', '55 51 991234567', '5551991234567']) {
    assert.equal(mobileFromLead(raw), '5551991234567', raw);
  }
});
test('recusa fixo, curto e vazio', () => {
  for (const raw of ['(51) 3333-4444', '99123-4567', '', null, '+1 415 555 2671']) assert.equal(mobileFromLead(raw), null, String(raw));
});
test('com e sem nono dígito é a mesma chave', () => {
  assert.equal(phoneKey('5551991234567'), phoneKey('555191234567'));
  assert.equal(phoneKey('5551991234567'), '5191234567');
  assert.notEqual(phoneKey('5551991234567'), phoneKey('5511991234567'));
});

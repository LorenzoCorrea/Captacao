import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReply, OFFER, firstMessage, FIXED } from '../src/bot/offer.js';

test('expande marcadores', () => {
  assert.equal(renderReply('Fica {preco}.').text, 'Fica R$ 550, com site e hospedagem inclusos.');
});
for (const [bad, reason] of [
  ['Faço por 400', 'digit'], ['Faço por quinhentos reais', 'number-word'], ['Em dois dias entrego', 'number-word'],
  ['Veja https://x.com', 'link'], ['Veja x.com.br', 'link'], ['Escreva para a@b.com', 'email'],
  ['Minha chave Pix é esta', 'pix'], ['Custa {desconto}', 'placeholder'], ['', 'empty'], ['a'.repeat(1001), 'length'],
]) {
  test(`bloqueia ${reason}: ${bad.slice(0, 20)}`, () => assert.deepEqual(renderReply(bad), { ok: false, reason }));
}
test('Pix só aparece vindo da oferta', () => {
  assert.equal(renderReply('O {sinal}.').ok, true);
  assert.match(renderReply('O {sinal}.').text, /30% no Pix \(R\$ 165\)/);
});
test('"um" e "uma" são permitidos', () => assert.equal(renderReply('Uma página para um comércio.').ok, true));
test('oferta tem os valores do spec', () => {
  assert.match(OFFER.preco, /R\$ 550/);
  assert.match(OFFER.saldo, /R\$ 385/);
  assert.match(OFFER.renovacao, /R\$ 50 por ano/);
  assert.match(OFFER.refazer, /R\$ 100/);
});
test('primeira mensagem se identifica, oferece saída e aceita nome com número', () => {
  for (const variant of ['A', 'B']) {
    const text = firstMessage(variant, 'Barbearia 24h');
    assert.match(text, /assistente virtual do Lorenzo/);
    assert.match(text, /não quero/);
    assert.match(text, /Barbearia 24h/);
    assert.match(text, /R\$ 550/);
    assert.match(text, /expira a cada 1 ano/);
  }
});
test('textos fixos não trazem dados de pagamento além da oferta', () => {
  assert.match(FIXED.accepted, /R\$ 165/);
  assert.match(FIXED.accepted, /Lorenzo/);
  assert.doesNotMatch(Object.values(FIXED).join(' '), /https?:|chave/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFER, firstMessage, FIXED, ANSWERS, TOPICS, answerFor, safeName, trimRepeats, acceptedText } from '../src/bot/offer.js';

test('oferta tem os valores do spec', () => {
  assert.match(OFFER.preco, /R\$ 550/);
  assert.match(OFFER.sinal, /sinal de 30% no Pix \(R\$ 165\)/);
  assert.match(OFFER.saldo, /R\$ 385/);
  assert.match(OFFER.renovacao, /R\$ 50 por ano/);
  assert.match(OFFER.refazer, /R\$ 100/);
  assert.match(OFFER.prazo, /4 dias corridos/);
  assert.match(ANSWERS.price, /4 dias corridos/);
});

test('primeira mensagem é curta, fala como Lorenzo, oferece saída e não despeja a oferta', () => {
  for (const variant of ['A', 'B']) {
    const text = firstMessage(variant, 'Barbearia 24h');
    assert.match(text, /Lorenzo/);
    assert.doesNotMatch(text, /assistente virtual|R\$|domínio/i);
    assert.match(text, /Barbearia 24h/);
    assert.match(text, /não te chamo mais/);
    assert.ok(text.length <= 220, `${variant}: ${text.length}`);
  }
});

test('como funciona vende o benefício, sem preço, e puxa a próxima pergunta', () => {
  assert.doesNotMatch(ANSWERS.how_it_works, /R\$|domínio|sinal/i);
  assert.match(ANSWERS.how_it_works, /\?$/);
});

test('todo preço leva o aviso do domínio, e quem aceita já sabe o total', () => {
  for (const text of [ANSWERS.price, ANSWERS.included, FIXED.accepted]) {
    assert.match(text, /R\$ 550/);
    assert.match(text, /expira a cada 1 ano/);
    assert.match(text, /R\$ 50 por ano/);
  }
});

test('sinal nunca aparece sem o valor', () => {
  for (const [name, text] of Object.entries({ ...ANSWERS, ...FIXED })) {
    if (/sinal/i.test(text)) assert.match(text, /R\$ 165/, name);
  }
  assert.match(FIXED.accepted, /R\$ 385/);
});

test('respostas são curtas', () => {
  for (const [name, text] of Object.entries({ ...ANSWERS, ...FIXED })) assert.ok(text.length <= 300, `${name}: ${text.length}`);
});

test('nome editável por terceiros não leva preço, link ou Pix na mensagem', () => {
  for (const bad of ['Bar R$ 100', 'Bar www.golpe.com', 'golpe.com', 'Chave pix aqui', 'Bar {preco}', 'a@b.com', 'x'.repeat(61), '', null]) {
    assert.equal(safeName(bad), 'seu comércio', String(bad));
  }
  assert.equal(safeName('Barbearia 24h'), 'Barbearia 24h');
  assert.equal(safeName('Salão Dª Ana & Filhas'), 'Salão Dª Ana & Filhas');
  assert.match(firstMessage('A', 'Bar www.golpe.com'), /seu comércio/);
  assert.doesNotMatch(firstMessage('A', 'Bar www.golpe.com'), /golpe/);
});

test('nenhum texto do bot tem link, chave ou marcador solto', () => {
  const all = [...Object.values(FIXED), ...Object.values(ANSWERS)].join(' ');
  assert.doesNotMatch(all, /https?:|www\.|chave|[{}]/i);
});

test('respostas de tópico são compostas sem repetição e recusam desconhecidos', () => {
  assert.equal(answerFor(['price']), ANSWERS.price);
  assert.equal(answerFor(['price', 'price']), ANSWERS.price);
  assert.equal(answerFor(['price', 'deadline']), `${ANSWERS.price}\n\n${ANSWERS.deadline}`);
  assert.equal(answerFor(['constructor']), null);
  assert.equal(answerFor(['price', 'desconto']), null);
  assert.equal(answerFor([]), null);
  assert.equal(answerFor('price'), null);
  assert.equal(answerFor(['price', 'deadline', 'payment']), null, 'mais de dois: Lorenzo responde');
  assert.deepEqual(Object.keys(ANSWERS).sort(), [...TOPICS].sort());
});

test('a apresentação geral não é colada em outra resposta', () => {
  assert.equal(answerFor(['price', 'how_it_works']), ANSWERS.price);
  assert.equal(answerFor(['how_it_works', 'price']), ANSWERS.price);
  assert.equal(answerFor(['how_it_works']), ANSWERS.how_it_works);
  assert.equal(answerFor(['how_it_works', 'price', 'deadline']), `${ANSWERS.price}\n\n${ANSWERS.deadline}`);
});

test('prazo é prometido como "até 4 dias corridos"', () => {
  assert.match(OFFER.prazo, /^até 4 dias corridos/);
  for (const text of [ANSWERS.price, ANSWERS.deadline]) assert.match(text, /até 4 dias corridos/);
  assert.doesNotMatch([...Object.values(ANSWERS), ...Object.values(FIXED)].join(' '), /(?<!até )4 dias corridos/);
});

test('textos fixos trazem os valores e o aviso de juros', () => {
  assert.match(FIXED.accepted, /R\$ 165/);
  assert.match(FIXED.accepted, /dados de pagamento/);
  assert.match(FIXED.installments, /juros/);
  assert.match(FIXED.botQuestion, /automatizada/);
  assert.match(ANSWERS.domain, /expira a cada 1 ano/);
  assert.match(ANSWERS.maintenance, /primeiros meses/);
  assert.match(ANSWERS.redo, /R\$ 100/);
});

test('não repete o que o lead já leu', () => {
  const said = ANSWERS.price; // preço, sinal, prazo e renovação já ditos
  assert.doesNotMatch(trimRepeats(ANSWERS.included, said), /expira/);
  assert.doesNotMatch(trimRepeats(FIXED.discount, said), /O valor é/);
  assert.match(trimRepeats(FIXED.discount, said), /parcelar/);
  assert.equal(answerFor(['domain'], said), ANSWERS.domain, 'pergunta direta sobre o domínio responde mesmo assim');
  assert.equal(answerFor(['price', 'included']).match(/expira/g).length, 1, 'nem dentro da mesma resposta');
});

test('aceite: completo se não viu o preço, curto se já viu', () => {
  assert.equal(acceptedText(''), FIXED.accepted);
  const short = acceptedText(ANSWERS.price);
  assert.match(short, /R\$ 165/);
  assert.match(short, /R\$ 385/);
  assert.doesNotMatch(short, /R\$ 550|expira/);
  assert.doesNotMatch(acceptedText(ANSWERS.price + ANSWERS.payment), /R\$ 385/, 'restante já dito');
});

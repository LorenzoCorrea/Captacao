import test from 'node:test';
import assert from 'node:assert/strict';
import { replyToLead, handleInbound, isOptOut, MAX_AI_TURNS } from '../src/bot/engine.js';
import { FIXED, OFFER } from '../src/bot/offer.js';
import { parseAiContent } from '../src/bot/ai.js';

function setup(aiResult, { status = 'active', ...over } = {}) {
  const conv = { lead_id: 'L', phone: '5551991234567', phone_key: '5191234567', name: 'Aurora', status, reason: null, ai_turns: 0, discount_asks: 0, ai_first_fail: null, search_id: 's', ...over };
  const log = { sent: [], notes: [], stages: [], optouts: [], msgs: [] };
  const db = {
    botGet: async () => ({ ...conv }),
    botSetStatus: async (_, s, r = null) => { conv.status = s; conv.reason = r; },
    botAddMessage: async (m) => { if (log.msgs.some((x) => x.id === m.id)) return false; log.msgs.push(m); return true; },
    botHistory: async () => log.msgs,
    botIncrementTurn: async () => ++conv.ai_turns,
    botIncrementDiscount: async () => ++conv.discount_asks,
    botSetAiFailure: async (_, first, next) => { conv.ai_first_fail = first; conv.ai_next_retry = next; },
    botClearAiFailure: async () => { conv.ai_first_fail = null; conv.ai_next_retry = null; },
    botOptOut: async (k) => log.optouts.push(k),
  };
  const deps = {
    db,
    ai: typeof aiResult === 'function' ? aiResult : async () => aiResult,
    gateway: { send: async (_, text) => { log.sent.push(text); return `id-${log.sent.length}`; } },
    notify: async (text) => log.notes.push(text),
    setStage: async (_, stage) => log.stages.push(stage),
    now: () => new Date('2026-11-05T12:00:00Z'),
  };
  return { conv, log, deps };
}

test('continue: envia com a oferta expandida', async () => {
  const { conv, log, deps } = setup({ reply: 'Fica {preco}.', intent: 'continue' });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [`Fica ${OFFER.preco}.`]);
  assert.equal(conv.status, 'active');
  assert.equal(log.msgs[0].source, 'bot');
});

test('accepted: explica o sinal, aguarda fechamento e avisa uma vez', async () => {
  const { conv, log, deps } = setup({ reply: 'qualquer coisa 999', intent: 'accepted' });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.accepted]);
  assert.equal(conv.status, 'ready_to_close');
  assert.equal(log.notes.length, 1);
  assert.deepEqual(log.stages, ['qualificado']);
});

test('installments: avisa dos juros, pausa e pede o link', async () => {
  const { conv, log, deps } = setup({ reply: '', intent: 'installments' });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.installments]);
  assert.match(FIXED.installments, /juros/);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'installments']);
  assert.match(log.notes[0], /link/i);
});

test('discount: nega uma vez e, se insistir, pausa', async () => {
  const { conv, log, deps } = setup({ reply: '', intent: 'discount' });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.discount]);
  assert.equal(conv.status, 'active');
  await replyToLead(conv, deps);
  assert.equal(log.sent[1], FIXED.handoff);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'discount_insist']);
});

for (const intent of ['human_requested', 'unknown']) {
  test(`${intent}: chama Lorenzo e pausa`, async () => {
    const { conv, log, deps } = setup({ reply: '', intent });
    await replyToLead(conv, deps);
    assert.deepEqual(log.sent, [FIXED.handoff]);
    assert.deepEqual([conv.status, conv.reason], ['paused', intent]);
    assert.equal(log.notes.length, 1);
  });
}

test('resposta reprovada no filtro não é enviada', async () => {
  const { conv, log, deps } = setup({ reply: 'Faço por 400 reais', intent: 'continue' });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, []);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'filter:digit']);
  assert.equal(log.notes.length, 1);
});

test('limite de respostas: não chama a IA, pausa e avisa', async () => {
  let called = false;
  const { conv, log, deps } = setup(async () => { called = true; return { reply: 'oi', intent: 'continue' }; }, { ai_turns: MAX_AI_TURNS });
  assert.equal(MAX_AI_TURNS, 10);
  await replyToLead(conv, deps);
  assert.equal(called, false);
  assert.deepEqual(log.sent, []);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'turn_limit']);
  assert.equal(log.notes.length, 1);
});

test('IA fora: não envia e agenda nova tentativa em 5 minutos', async () => {
  const { conv, log, deps } = setup(async () => { throw new Error('429'); });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, []);
  assert.equal(conv.status, 'active');
  assert.equal(conv.ai_next_retry.toISOString(), '2026-11-05T12:05:00.000Z');
  assert.equal(log.notes.length, 0);
});

test('IA fora por 1 hora: pausa e avisa', async () => {
  const { conv, log, deps } = setup(async () => { throw new Error('429'); }, { ai_first_fail: new Date('2026-11-05T11:00:00Z') });
  await replyToLead(conv, deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'ai_unavailable']);
  assert.equal(log.notes.length, 1);
});

test('pausa durante a IA: nada é enviado', async () => {
  const holder = {};
  const { conv, log, deps } = setup(async () => { conv_ref(holder).status = 'paused'; return { reply: 'oi', intent: 'continue' }; });
  holder.conv = conv;
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, []);
  assert.equal(conv.status, 'paused');
});
const conv_ref = (h) => h.conv;

test('conversa pausada: não chama a IA', async () => {
  let called = false;
  const { conv, deps } = setup(async () => { called = true; return { reply: 'oi', intent: 'continue' }; }, { status: 'paused' });
  await replyToLead(conv, deps);
  assert.equal(called, false);
});

test('falha no envio: mantém ativa e tenta de novo', async () => {
  const { conv, log, deps } = setup({ reply: 'oi', intent: 'continue' });
  deps.gateway.send = async () => { throw new Error('gateway'); };
  await replyToLead(conv, deps);
  assert.equal(log.msgs.length, 0);
  assert.equal(conv.status, 'active');
  assert.ok(conv.ai_next_retry);
});

test('áudio ou imagem: pausa e avisa, sem IA', async () => {
  const { conv, log, deps } = setup({ reply: 'oi', intent: 'continue' });
  await handleInbound({ conv, id: 'a1', text: '', hasText: false }, deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'media']);
  assert.equal(log.notes.length, 1);
  assert.deepEqual(log.sent, []);
});

test('isOptOut distingue pedido de saída de conversa normal', () => {
  for (const t of ['não quero', 'NAO QUERO', 'pare', 'sair', 'remover', 'Não quero, obrigado', 'não tenho interesse.', 'pare de me mandar mensagem']) assert.equal(isOptOut(t), true, t);
  for (const t of ['não quero pagar agora, parcela?', 'quero sair do Instagram e ter site', 'como faço para parar de perder cliente?', 'sim']) assert.equal(isOptOut(t), false, t);
});

test('pedido de saída: grava, despede uma vez e não chama a IA', async () => {
  const { conv, log, deps } = setup(async () => { throw new Error('não deveria chamar'); });
  await handleInbound({ conv, id: 'o1', text: 'não quero', hasText: true }, deps);
  await handleInbound({ conv, id: 'o1', text: 'não quero', hasText: true }, deps);
  assert.deepEqual(log.optouts, ['5191234567']);
  assert.deepEqual(log.sent, [FIXED.goodbye]);
  assert.equal(conv.status, 'opted_out');
  assert.deepEqual(log.stages, ['descartado']);
});

test('saída com a conversa pausada grava sem falar por cima de Lorenzo', async () => {
  const { conv, log, deps } = setup(null, { status: 'paused', reason: 'owner_replied' });
  await handleInbound({ conv, id: 'o2', text: 'sair', hasText: true }, deps);
  assert.deepEqual(log.optouts, ['5191234567']);
  assert.deepEqual(log.sent, []);
  assert.equal(log.notes.length, 1);
});

test('intent opt_out vinda da IA segue a mesma saída', async () => {
  const { conv, log, deps } = setup({ reply: '', intent: 'opt_out' });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.goodbye]);
  assert.equal(conv.status, 'opted_out');
});

test('parseAiContent aceita JSON em bloco e recusa formato inválido', () => {
  assert.deepEqual(parseAiContent('```json\n{"reply":"oi","intent":"continue"}\n```'), { reply: 'oi', intent: 'continue' });
  assert.throws(() => parseAiContent('oi'));
  assert.throws(() => parseAiContent('{"reply":"oi","intent":"vender"}'));
  assert.throws(() => parseAiContent('{"intent":"continue"}'));
});

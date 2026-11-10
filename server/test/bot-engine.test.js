import test from 'node:test';
import assert from 'node:assert/strict';
import { replyToLead, handleInbound, isOptOut, isBotQuestion, isAutoReply, MAX_AI_TURNS, sendAndRecord } from '../src/bot/engine.js';
import { FIXED, ANSWERS } from '../src/bot/offer.js';
import { parseAiContent } from '../src/bot/ai.js';

function setup(aiResult, { status = 'active', ...over } = {}) {
  const conv = { lead_id: 'L', phone: '5551991234567', phone_key: '5191234567', name: 'Aurora', status, reason: null, ai_turns: 0, discount_asks: 0, ai_first_fail: null, search_id: 's', ...over };
  const log = { sent: [], notes: [], stages: [], optouts: [], msgs: [{ id: 'm0', direction: 'in', source: 'lead', body: 'oi' }], disabled: [] };
  const db = {
    botGet: async () => ({ ...conv }),
    botTransition: async (_, from, to, reason = null) => {
      if (!from.includes(conv.status)) return false;
      conv.status = to; conv.reason = reason;
      return true;
    },
    botMarkOptOut: async (_, key) => { log.optouts.push(key); conv.status = 'opted_out'; conv.reason = null; },
    botIsOptedOut: async (key) => log.optouts.includes(key),
    botAddMessage: async (m) => { if (log.msgs.some((x) => x.id === m.id)) return false; log.msgs.push(m); return true; },
    botHistory: async () => [...log.msgs],
    botIncrementTurn: async () => ++conv.ai_turns,
    botIncrementDiscount: async () => ++conv.discount_asks,
    botSetAiFailure: async (_, first, next) => { conv.ai_first_fail = first; conv.ai_next_retry = next; },
    botClearAiFailure: async () => { conv.ai_first_fail = null; conv.ai_next_retry = null; },
    botMarkAuto: async (ids) => { log.auto = ids; },
  };
  const deps = {
    db,
    ai: typeof aiResult === 'function' ? aiResult : async () => aiResult,
    gateway: { send: async (_, text) => { log.sent.push(text); return `id-${log.sent.length}`; } },
    notify: async (text) => log.notes.push(text),
    setStage: async (_, stage) => log.stages.push(stage),
    disableBot: async (r) => log.disabled.push(r),
    now: () => new Date('2026-11-05T12:00:00Z'),
  };
  return { conv, log, deps };
}
const ask = (topics) => ({ intent: 'continue', topics });

test('continue: envia só a resposta aprovada do tópico', async () => {
  const { conv, log, deps } = setup(ask(['price']));
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [ANSWERS.price]);
  assert.equal(conv.status, 'active');
  assert.equal(log.msgs.at(-1).source, 'bot');
  assert.equal(conv.ai_turns, 1);
});

test('tópico inexistente ou vazio: não inventa, chama Lorenzo e pausa', async () => {
  for (const topics of [['desconto'], [], ['price', 'x']]) {
    const { conv, log, deps } = setup(ask(topics));
    await replyToLead(conv, deps);
    assert.deepEqual(log.sent, [FIXED.handoff]);
    assert.deepEqual([conv.status, conv.reason], ['paused', 'unknown']);
    assert.equal(log.notes.length, 1);
  }
});

test('accepted: grava o estado antes de enviar, explica o sinal e avisa uma vez', async () => {
  const seen = [];
  const { conv, log, deps } = setup({ intent: 'accepted', topics: [] });
  const send = deps.gateway.send;
  deps.gateway.send = (...a) => { seen.push(conv.status); return send(...a); };
  await replyToLead(conv, deps);
  assert.deepEqual(seen, ['ready_to_close']);
  assert.deepEqual(log.sent, [FIXED.accepted]);
  assert.equal(conv.status, 'ready_to_close');
  assert.equal(log.notes.length, 1);
  assert.deepEqual(log.stages, ['qualificado']);
});

test('installments: avisa dos juros, pausa e pede o link', async () => {
  const { conv, log, deps } = setup({ intent: 'installments', topics: [] });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.installments]);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'installments']);
  assert.match(log.notes[0], /link/i);
});

test('discount: nega uma vez e, se insistir, pausa', async () => {
  const { conv, log, deps } = setup({ intent: 'discount', topics: [] });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.discount]);
  assert.equal(conv.status, 'active');
  await replyToLead(conv, deps);
  assert.equal(log.sent[1], FIXED.handoff);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'discount_insist']);
});

for (const intent of ['human_requested', 'unknown']) {
  test(`${intent}: chama Lorenzo e pausa`, async () => {
    const { conv, log, deps } = setup({ intent, topics: [] });
    await replyToLead(conv, deps);
    assert.deepEqual(log.sent, [FIXED.handoff]);
    assert.deepEqual([conv.status, conv.reason], ['paused', intent]);
    assert.equal(log.notes.length, 1);
  });
}

test('limite de respostas: não chama a IA, pausa e avisa', async () => {
  let called = false;
  const { conv, log, deps } = setup(async () => { called = true; return ask(['price']); }, { ai_turns: MAX_AI_TURNS });
  assert.equal(MAX_AI_TURNS, 10);
  await replyToLead(conv, deps);
  assert.equal(called, false);
  assert.deepEqual(log.sent, []);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'turn_limit']);
  assert.equal(log.notes.length, 1);
});

test('IA fora: não envia, não conta turno e agenda nova tentativa em 5 minutos', async () => {
  const { conv, log, deps } = setup(async () => { throw new Error('429'); });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, []);
  assert.equal(conv.status, 'active');
  assert.equal(conv.ai_turns, 0);
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
  const { conv, log, deps } = setup(async () => { holder.conv.status = 'paused'; return ask(['price']); });
  holder.conv = conv;
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, []);
  assert.equal(conv.status, 'paused');
});

test('mensagem nova durante a IA: descarta a resposta e reavalia no próximo ciclo', async () => {
  const holder = {};
  const { conv, log, deps } = setup(async () => {
    holder.log.msgs.push({ id: 'm1', direction: 'in', source: 'lead', body: 'me tira da lista' });
    return ask(['price']);
  });
  holder.log = log;
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, []);
  assert.equal(conv.ai_turns, 0);
});

test('conversa pausada: não chama a IA', async () => {
  let called = false;
  const { conv, deps } = setup(async () => { called = true; return ask(['price']); }, { status: 'paused' });
  await replyToLead(conv, deps);
  assert.equal(called, false);
});

test('falha no envio: sem repetir, pausa, desliga e não conta turno nem desconto', async () => {
  const { conv, log, deps } = setup({ intent: 'discount', topics: [] });
  deps.gateway.send = async () => { throw new Error('gateway'); };
  await replyToLead(conv, deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'send_failed']);
  assert.deepEqual(log.disabled, ['send_failed']);
  assert.deepEqual([conv.ai_turns, conv.discount_asks, conv.ai_next_retry], [0, 0, undefined]);
});

test('falha ao enviar o aceite: estado mantido, sem repetir, e Lorenzo é avisado', async () => {
  const { conv, log, deps } = setup({ intent: 'accepted', topics: [] });
  deps.gateway.send = async () => { throw new Error('gateway'); };
  await replyToLead(conv, deps);
  assert.equal(conv.status, 'ready_to_close');
  assert.deepEqual(log.disabled, ['send_failed']);
  assert.ok(log.notes.length >= 1);
  assert.equal(conv.ai_next_retry, undefined);
});

test('falha ao gravar depois de enviar não reenvia', async () => {
  const { conv, log, deps } = setup(ask(['price']));
  deps.db.botAddMessage = async () => { throw new Error('banco'); };
  await replyToLead(conv, deps);
  assert.equal(log.sent.length, 1);
  assert.equal(conv.status, 'paused');
  await replyToLead(conv, deps);
  assert.equal(log.sent.length, 1);
});

test('sendAndRecord relê o estado depois de esperar outro envio', async () => {
  const { conv, log, deps } = setup(null);
  let release;
  const slow = deps.gateway.send;
  deps.gateway.send = (p, t) => new Promise((resolve) => { release = () => resolve(slow(p, t)); });
  const first = sendAndRecord(conv, 'primeiro', deps);
  await new Promise((r) => setImmediate(r));
  const second = sendAndRecord(conv, 'segundo', deps, { allow: ['active'] });
  conv.status = 'opted_out';
  release();
  await first;
  assert.equal(await second, null);
  assert.deepEqual(log.sent, ['primeiro']);
});

test('sendAndRecord não envia a quem está na lista de saída', async () => {
  const { conv, log, deps } = setup(null);
  log.optouts.push(conv.phone_key);
  assert.equal(await sendAndRecord(conv, 'x', deps, { allow: ['active'] }), null);
  assert.deepEqual(log.sent, []);
});

test('áudio ou imagem: pausa e avisa, sem IA', async () => {
  const { conv, log, deps } = setup(ask(['price']));
  await handleInbound({ conv, id: 'a1', text: '', hasText: false }, deps);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'media']);
  assert.equal(log.notes.length, 1);
  assert.deepEqual(log.sent, []);
});

test('reprocessar webhook depois de falha ainda aplica a pausa de mídia', async () => {
  const { conv, deps } = setup(null);
  await deps.db.botAddMessage({ id: 'a1', leadId: 'L', direction: 'in', source: 'lead', body: '[mídia]' });
  await handleInbound({ conv, id: 'a1', text: '', hasText: false }, deps);
  assert.equal(conv.status, 'paused');
});

test('isOptOut distingue pedido de saída de conversa normal', () => {
  for (const t of ['não quero', 'NAO QUERO', 'pare', 'para', 'pode parar', 'sair', 'remover', 'stop', 'Não quero, obrigado', 'não tenho interesse.', 'não tenho interesse no momento', 'pare de me mandar mensagem', 'me tira da lista', 'não quero receber mensagens', 'não me chame mais', 'por favor não me mande mais mensagem']) assert.equal(isOptOut(t), true, t);
  for (const t of ['não quero pagar agora, parcela?', 'quero sair do Instagram e ter site', 'como faço para parar de perder cliente?', 'sim', 'para quando fica pronto?', 'não quero site caro']) assert.equal(isOptOut(t), false, t);
});

test('pedido de saída: grava antes da despedida, despede uma vez e não chama a IA', async () => {
  const seen = [];
  const { conv, log, deps } = setup(async () => { throw new Error('não deveria chamar'); });
  const send = deps.gateway.send;
  deps.gateway.send = (...a) => { seen.push(conv.status); return send(...a); };
  await handleInbound({ conv, id: 'o1', text: 'não quero', hasText: true }, deps);
  await handleInbound({ conv: { ...conv }, id: 'o1', text: 'não quero', hasText: true }, deps);
  assert.deepEqual(seen, ['opted_out']);
  assert.deepEqual(log.optouts, ['5191234567']);
  assert.deepEqual(log.sent, [FIXED.goodbye]);
  assert.deepEqual(log.stages, ['descartado']);
});

test('falha na despedida não reverte a saída nem desperta a IA', async () => {
  let called = false;
  const { conv, log, deps } = setup(async () => { called = true; return ask(['price']); });
  deps.gateway.send = async () => { throw new Error('gateway'); };
  await handleInbound({ conv, id: 'o1', text: 'pare', hasText: true }, deps);
  assert.equal(conv.status, 'opted_out');
  assert.deepEqual(log.optouts, ['5191234567']);
  await replyToLead(conv, deps);
  assert.equal(called, false);
});

test('saída com a conversa pausada grava sem falar por cima de Lorenzo', async () => {
  const { conv, log, deps } = setup(null, { status: 'paused', reason: 'owner_replied' });
  await handleInbound({ conv, id: 'o2', text: 'sair', hasText: true }, deps);
  assert.deepEqual(log.optouts, ['5191234567']);
  assert.deepEqual(log.sent, []);
  assert.equal(log.notes.length, 1);
});

test('intent opt_out vinda da IA segue a mesma saída', async () => {
  const { conv, log, deps } = setup({ intent: 'opt_out', topics: [] });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.goodbye]);
  assert.equal(conv.status, 'opted_out');
});

test('isBotQuestion reconhece a pergunta sem confundir conversa normal', () => {
  for (const t of ['é robô?', 'isso é um bot?', 'estou falando com uma IA?', 'é inteligência artificial?', 'você é uma pessoa de verdade?', 'é você mesmo, Lorenzo?', 'é vc mesmo?', 'é o Lorenzo mesmo?', 'quem está falando?', 'é gente?', 'tem alguém aí?', 'é automático?', 'é o chatgpt?', 'é humano?']) assert.equal(isBotQuestion(t), true, t);
  for (const t of ['eu ia te ligar', 'quanto fica?', 'meu site é de robótica', 'trabalho com automação', 'aceita máquina de cartão?', 'vendo portão automático', 'liguei e ia falar']) assert.equal(isBotQuestion(t), false, t);
});

test('perguntou se é robô: pausa antes, diz a verdade, avisa e não chama a IA', async () => {
  const seen = [];
  const { conv, log, deps } = setup(async () => { throw new Error('não deveria chamar'); });
  const send = deps.gateway.send;
  deps.gateway.send = (...a) => { seen.push(conv.status); return send(...a); };
  await handleInbound({ conv, id: 'b1', text: 'é robô?', hasText: true }, deps);
  assert.deepEqual(seen, ['paused']);
  assert.deepEqual(log.sent, [FIXED.botQuestion]);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'asked_if_bot']);
  assert.equal(log.notes.length, 1);
});

test('falha ao responder "é robô?" não deixa a IA responder depois', async () => {
  let called = false;
  const { conv, deps } = setup(async () => { called = true; return ask(['price']); });
  deps.gateway.send = async () => { throw new Error('gateway'); };
  await handleInbound({ conv, id: 'b1', text: 'é robô?', hasText: true }, deps);
  assert.equal(conv.status, 'paused');
  await replyToLead(conv, deps);
  assert.equal(called, false);
});

test('intent asked_if_bot da IA segue a mesma resposta fixa', async () => {
  const { conv, log, deps } = setup({ intent: 'asked_if_bot', topics: [] });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.botQuestion]);
  assert.deepEqual([conv.status, conv.reason], ['paused', 'asked_if_bot']);
});

test('parseAiContent aceita JSON em bloco e recusa formato inválido', () => {
  assert.deepEqual(parseAiContent('```json\n{"intent":"continue","topics":["price"]}\n```'), { intent: 'continue', topics: ['price'] });
  assert.deepEqual(parseAiContent('{"intent":"accepted"}'), { intent: 'accepted', topics: [] });
  assert.throws(() => parseAiContent('oi'));
  assert.throws(() => parseAiContent('{"intent":"vender","topics":[]}'));
  assert.throws(() => parseAiContent('{"intent":"continue","topics":"price"}'));
});

test('accepted depois do preço: usa o histórico e manda o aceite curto', async () => {
  const { conv, log, deps } = setup({ intent: 'accepted', topics: [] });
  log.msgs.unshift({ id: 'b0', direction: 'out', source: 'bot', body: ANSWERS.price });
  await replyToLead(conv, deps);
  assert.match(log.sent[0], /^Que bom, fico feliz!/);
  assert.doesNotMatch(log.sent[0], /R\$ 550/);
});

test('bot calado: lead que escreve avisa Lorenzo até ele assumir', async () => {
  for (const status of ['paused', 'ready_to_close']) {
    const { conv, log, deps } = setup(null, { status });
    await handleInbound({ conv, id: 'w1', text: 'Tem desconto?', hasText: true }, deps);
    assert.equal(log.notes.length, 1, status);
    assert.match(log.notes[0], /esperando você: "Tem desconto\?"/);
    assert.deepEqual(log.sent, [], 'o bot continua calado');
    log.msgs.push({ id: 'own', direction: 'out', source: 'owner', body: 'oi, aqui é o Lorenzo' });
    await handleInbound({ conv, id: 'w2', text: 'ok', hasText: true }, deps);
    assert.equal(log.notes.length, 1, 'Lorenzo já assumiu');
  }
});

test('conversa ativa: mensagem comum não gera aviso', async () => {
  const { conv, log, deps } = setup(null);
  await handleInbound({ conv, id: 'w1', text: 'quanto custa?', hasText: true }, deps);
  assert.equal(log.notes.length, 0);
});

// Frases reais de comércios abordados por Lorenzo em 2026.
const AUTO_SAMPLES = [
  '✂️ Seja bem-vindo! Eu sou o Maninho, assistente virtual da Dom Caetano, e tô aqui pra facilitar tua vida.',
  'Olá! Clínica Veterinária Latimia agradece o seu contato 🐶🐱 Como podemos ajudar você e seu pet hoje?',
  '‎Castelo Day Hospital agradece seu contato. Como podemos ajudar?',
  'Agradecemos sua mensagem. Responderemos assim que possível. 👍🏻😃',
];

test('resposta automática do comércio é reconhecida; conversa de gente não', () => {
  for (const t of AUTO_SAMPLES) assert.equal(isAutoReply(t), true, t);
  for (const t of ['Boa tarde', 'O que seria?', 'Vou passar ao responsável', 'Esse valor é uma vez só?', 'Você é um robô?']) assert.equal(isAutoReply(t), false, t);
});

test('menu automático não responde, não pausa e não vira pergunta de robô', async () => {
  const { conv, log, deps } = setup(null);
  await handleInbound({ conv, id: 'a1', text: AUTO_SAMPLES[0], hasText: true }, deps);
  assert.equal(log.msgs.at(-1).source, 'auto');
  assert.deepEqual([conv.status, log.sent.length, log.notes.length], ['active', 0, 0]);
});

test('IA reconhece automática: marca, fica calado e não gasta turno', async () => {
  const { conv, log, deps } = setup({ intent: 'auto_reply', topics: [] });
  await replyToLead(conv, deps);
  assert.deepEqual(log.auto, ['m0']);
  assert.deepEqual([log.sent.length, conv.ai_turns, conv.status], [0, 0, 'active']);
});

test('recepcionista e ocupado: resposta curta e o bot segue', async () => {
  for (const [intent, text] of [['gatekeeper', FIXED.gatekeeper], ['busy', FIXED.busy]]) {
    const { conv, log, deps } = setup({ intent, topics: [] });
    await replyToLead(conv, deps);
    assert.deepEqual([log.sent, conv.status, log.notes.length], [[text], 'active', 0], intent);
  }
});

test('"em outro momento": despede, encerra, avisa e não bloqueia', async () => {
  const { conv, log, deps } = setup({ intent: 'later', topics: [] });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.later]);
  assert.deepEqual([conv.status, conv.reason], ['closed', 'later']);
  assert.match(log.notes[0], /outro momento/);
  assert.deepEqual(log.optouts, []);
});

test('número errado: pede desculpas, encerra, avisa e não oferece o site', async () => {
  const { conv, log, deps } = setup({ intent: 'wrong_contact', topics: [] });
  await replyToLead(conv, deps);
  assert.deepEqual(log.sent, [FIXED.wrongContact]);
  assert.deepEqual([conv.status, conv.reason], ['closed', 'wrong_contact']);
  assert.match(log.notes[0], /não é desse comércio/);
  assert.deepEqual(parseAiContent('{"intent":"wrong_contact","topics":[]}').intent, 'wrong_contact');
});

test('prévia: o bot aceita o pedido sem mandar link e pausa para Lorenzo montar', async () => {
  const { conv, log, deps } = setup(ask(['preview', 'price']), { niche: 'barbearia' });
  await replyToLead(conv, deps);
  assert.deepEqual([log.sent, conv.status], [[FIXED.previewRequested], 'paused']);
  assert.doesNotMatch(log.sent[0], /https?:/);
});

test('como funciona: benefício do nicho e pergunta se quer a prévia', async () => {
  const { conv, log, deps } = setup(ask(['how_it_works']), { niche: 'Clínica de estética' });
  await replyToLead(conv, deps);
  assert.match(log.sent[0], /procedimentos/);
  assert.match(log.sent[0], /prévia/);
});

import { FIXED, renderReply } from './offer.js';

export const MAX_AI_TURNS = 10;
const RETRY_MS = 5 * 60 * 1000;
const GIVE_UP_MS = 60 * 60 * 1000;

const normalize = (text) => String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// A mensagem inteira precisa ser um pedido de saída: "não quero pagar agora" segue na conversa.
const OPT_OUT = /^(nao quero( mais)?|nao tenho interesse|sem interesse|nao me interessa|pare|parar|chega|sair|remover|remova|cancelar|descadastrar|(pare|para) de (me )?(mandar|enviar)( mais)?( mensage(m|ns))?|nao (me )?(mande|envie)( mais)?( mensage(m|ns))?)( obrigad[oa])?$/;
export const isOptOut = (text) => OPT_OUT.test(normalize(text));

// O webhook aguarda o envio em curso para não confundir a mensagem do bot com uma de Lorenzo.
const sending = new Map();
export const pendingSend = (phoneKey) => sending.get(phoneKey) ?? Promise.resolve();

export function sendAndRecord(conv, text, { db, gateway }) {
  const run = (async () => {
    await (sending.get(conv.phone_key) ?? Promise.resolve()).catch(() => {});
    const id = await gateway.send(conv.phone, text);
    await db.botAddMessage({ id, leadId: conv.lead_id, direction: 'out', source: 'bot', body: text });
    return id;
  })();
  const tracked = run.finally(() => { if (sending.get(conv.phone_key) === tracked) sending.delete(conv.phone_key); });
  tracked.catch(() => {});
  sending.set(conv.phone_key, tracked);
  return tracked;
}

const label = (conv) => `${conv.name ?? 'Lead'} (${conv.phone})`;

const REASONS = {
  installments: 'quer parcelar: gere o link do Mercado Pago',
  discount_insist: 'insistiu em desconto',
  human_requested: 'pediu para falar com você',
  unknown: 'fez uma pergunta que o bot não soube responder',
};

async function optOut(conv, deps, { speak }) {
  const { db, setStage, notify } = deps;
  await db.botOptOut(conv.phone_key);
  if (speak) await sendAndRecord(conv, FIXED.goodbye, deps);
  else await notify(`${label(conv)} pediu para não receber mais mensagens.`);
  await db.botSetStatus(conv.lead_id, 'opted_out');
  await setStage?.(conv, 'descartado');
}

function decide(intent, reply, discountAsks) {
  switch (intent) {
    case 'accepted': return { text: FIXED.accepted, status: 'ready_to_close' };
    case 'installments': return { text: FIXED.installments, status: 'paused', reason: 'installments' };
    case 'discount':
      return discountAsks >= 2
        ? { text: FIXED.handoff, status: 'paused', reason: 'discount_insist' }
        : { text: FIXED.discount };
    case 'human_requested':
    case 'unknown': return { text: FIXED.handoff, status: 'paused', reason: intent };
    default: {
      const rendered = renderReply(reply);
      return rendered.ok ? { text: rendered.text } : { block: `filter:${rendered.reason}` };
    }
  }
}

async function registerFailure(conv, error, { db, notify, now }) {
  const at = now();
  const first = conv.ai_first_fail ? new Date(conv.ai_first_fail) : at;
  console.error('[bot] falha ao responder:', error.message);
  if (at - first >= GIVE_UP_MS) {
    await db.botClearAiFailure(conv.lead_id);
    await db.botSetStatus(conv.lead_id, 'paused', 'ai_unavailable');
    await notify(`Bot pausou ${label(conv)}: a IA ou o envio estão indisponíveis há 1 hora.`);
    return;
  }
  await db.botSetAiFailure(conv.lead_id, first, new Date(at.getTime() + RETRY_MS));
}

export async function replyToLead(conv, deps) {
  const { db, ai, notify, setStage } = deps;
  const current = await db.botGet(conv.lead_id);
  if (current?.status !== 'active') return;

  if (current.ai_turns >= MAX_AI_TURNS) {
    await db.botSetStatus(conv.lead_id, 'paused', 'turn_limit');
    await notify(`Bot pausou ${label(conv)}: a conversa chegou a ${MAX_AI_TURNS} respostas.`);
    return;
  }

  try {
    const answer = await ai(await db.botHistory(conv.lead_id), current);
    await db.botClearAiFailure(conv.lead_id);
    await db.botIncrementTurn(conv.lead_id);

    // Lorenzo pode ter assumido enquanto a IA gerava a resposta.
    if ((await db.botGet(conv.lead_id))?.status !== 'active') return;

    if (answer.intent === 'opt_out') return await optOut(current, deps, { speak: true });
    const discountAsks = answer.intent === 'discount' ? await db.botIncrementDiscount(conv.lead_id) : 0;
    const decision = decide(answer.intent, answer.reply, discountAsks);

    if (decision.block) {
      await db.botSetStatus(conv.lead_id, 'paused', decision.block);
      await notify(`Bot pausou ${label(conv)}: a resposta da IA foi bloqueada pelo filtro. Responda você.`);
      return;
    }

    await sendAndRecord(current, decision.text, deps);
    if (decision.status) await db.botSetStatus(conv.lead_id, decision.status, decision.reason ?? null);
    if (decision.status === 'ready_to_close') {
      await setStage?.(current, 'qualificado');
      await notify(`${label(current)} aceitou. Envie os dados de pagamento do sinal e feche.`);
    } else if (decision.status === 'paused') {
      await notify(`${label(current)} ${REASONS[decision.reason] ?? 'precisa de você'}.`);
    }
  } catch (e) {
    await registerFailure(current, e, deps);
  }
}

export async function handleInbound({ conv, id, text, hasText }, deps) {
  const { db, notify } = deps;
  const isNew = await db.botAddMessage({ id, leadId: conv.lead_id, direction: 'in', source: 'lead', body: hasText ? text : '[mídia]' });
  if (!isNew) return;
  if (conv.status === 'opted_out') return;

  if (hasText && isOptOut(text)) {
    await optOut(conv, deps, { speak: conv.status === 'active' });
    return;
  }
  if (!hasText && conv.status === 'active') {
    await db.botSetStatus(conv.lead_id, 'paused', 'media');
    await notify(`${label(conv)} enviou áudio ou mídia. O bot pausou para você responder.`);
  }
}

import { FIXED, answerFor, acceptedText, trimRepeats } from './offer.js';

export const MAX_AI_TURNS = 10;
const RETRY_MS = 5 * 60 * 1000;
const GIVE_UP_MS = 60 * 60 * 1000;

const normalize = (text) => String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// A mensagem inteira precisa ser um pedido de saída: "não quero pagar agora" segue na conversa.
const OPT_OUT = /^((por favor|pode) )?(nao quero( mais)?( receber)?( mais)?( mensage(m|ns))?|nao tenho interesse( no momento| agora)?|sem interesse|nao me interessa|pare|para|parar|chega|sair|stop|remover|remova|cancelar|descadastrar|me (tira|tire|remove|remova) da (sua )?lista|(pare|para) de (me )?(mandar|enviar|chamar)( mais)?( mensage(m|ns))?|nao (me )?(mande|envie|chame)( mais)?( mensage(m|ns))?)( mais)?( obrigad[oa])?$/;
export const isOptOut = (text) => OPT_OUT.test(normalize(text));

// Quem pergunta se fala com um robô recebe a verdade, sem passar pela IA.
const BOT_QUESTION = /\b(robo|bot|chatbot|chatgpt|gpt|inteligencia artificial|e automatic[oa]|(uma|um|com|e) ia$|(uma|um|com) ia\b|pessoa (de verdade|real)|humano|humana|(voce|vc) mesmo|lorenzo mesmo|quem (esta|ta) falando|quem fala|e gente|tem alguem ai|atendente virtual|assistente virtual)\b/;
export const isBotQuestion = (text) => BOT_QUESTION.test(normalize(text));

// O webhook aguarda o envio em curso para não confundir a mensagem do bot com uma de Lorenzo.
const sending = new Map();
export const pendingSend = (phoneKey) => sending.get(phoneKey) ?? Promise.resolve();

// Com "allow", relê o estado e a lista de saída logo antes de enviar. Devolve null se não enviou.
export function sendAndRecord(conv, text, { db, gateway }, { allow } = {}) {
  const previous = sending.get(conv.phone_key) ?? Promise.resolve();
  const run = (async () => {
    await previous.catch(() => {});
    if (allow) {
      const fresh = await db.botGet(conv.lead_id);
      if (!allow.includes(fresh?.status) || await db.botIsOptedOut(conv.phone_key)) return null;
    }
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
  preview_requested: 'quer a prévia do site: monte com as fotos e informações dele e mande por aqui',
  unknown: 'fez uma pergunta que o bot não soube responder',
  asked_if_bot: 'perguntou se é um robô: o bot disse que o atendimento é automatizado e você assume',
  wrong_contact: 'disse que o número não é desse comércio. O bot pediu desculpas e encerrou',
  later: 'disse que fica para outro momento. O bot se despediu sem bloquear o número',
};

// Menu, boas-vindas e "agradecemos o contato" do comércio: não é o lead falando.
const AUTO_REPLY = /\b(assistente virtual|atendente virtual|agradece (o )?(seu|sua) (contato|mensagem)|agradecemos (o |a )?(seu |sua )?(contato|mensagem)|responderemos (assim que|em breve|o mais breve)|retornaremos (assim que|em breve|o mais breve)|digite (o numero|uma opcao|a opcao)|escolha (uma|a) (das )?opc|fora do (nosso )?horario de atendimento|mensagem automatica|resposta automatica|seja bem vindo)/;
export const isAutoReply = (text) => AUTO_REPLY.test(normalize(text));

// A saída é gravada antes da despedida: uma falha no envio não pode manter a conversa ativa.
async function optOut(conv, deps, { speak }) {
  const { db, setStage, notify } = deps;
  await db.botMarkOptOut(conv.lead_id, conv.phone_key);
  if (speak) {
    await sendAndRecord(conv, FIXED.goodbye, deps).catch((e) => console.error('[bot] despedida não enviada:', e.message));
  } else {
    await notify(`${label(conv)} pediu para não receber mais mensagens.`);
  }
  await setStage?.(conv, 'descartado');
}

function decide({ intent, topics }, discountAsks, ctx) {
  const { said } = ctx;
  switch (intent) {
    case 'auto_reply': return { silent: true };
    case 'gatekeeper': return { text: FIXED.gatekeeper };
    case 'busy': return { text: FIXED.busy };
    case 'wrong_contact': return { text: FIXED.wrongContact, status: 'closed', reason: 'wrong_contact' };
    case 'later': return { text: FIXED.later, status: 'closed', reason: 'later' };
    case 'accepted': return { text: acceptedText(said), status: 'ready_to_close' };
    case 'installments': return { text: FIXED.installments, status: 'paused', reason: 'installments' };
    case 'discount':
      return discountAsks >= 2
        ? { text: FIXED.handoff, status: 'paused', reason: 'discount_insist' }
        : { text: trimRepeats(FIXED.discount, said) };
    case 'asked_if_bot': return { text: FIXED.botQuestion, status: 'paused', reason: 'asked_if_bot' };
    case 'human_requested': return { text: FIXED.handoff, status: 'paused', reason: 'human_requested' };
    case 'continue': {
      if (topics?.includes('preview')) return { text: FIXED.previewRequested, status: 'paused', reason: 'preview_requested' };
      const text = answerFor(topics, ctx);
      if (text) return { text };
    }
    // falls through
    default: return { text: FIXED.handoff, status: 'paused', reason: 'unknown' };
  }
}

async function registerAiFailure(conv, error, { db, notify, now }) {
  const at = now();
  const first = conv.ai_first_fail ? new Date(conv.ai_first_fail) : at;
  console.error('[bot] falha na IA:', error.message);
  if (at - first >= GIVE_UP_MS) {
    await db.botClearAiFailure(conv.lead_id);
    await db.botTransition(conv.lead_id, ['active'], 'paused', 'ai_unavailable');
    await notify(`Bot pausou ${label(conv)}: a IA está indisponível há 1 hora.`);
    return;
  }
  await db.botSetAiFailure(conv.lead_id, first, new Date(at.getTime() + RETRY_MS));
}

// Depois de um erro de envio não se sabe se a mensagem saiu: nunca reenvia.
async function sendFailure(conv, error, { db, disableBot, notify }) {
  console.error('[bot] falha no envio:', error.message);
  await db.botTransition(conv.lead_id, ['active'], 'paused', 'send_failed');
  await notify(`Falha ao responder ${label(conv)}. Confira a conversa no celular.`);
  await disableBot('send_failed');
}

export async function replyToLead(conv, deps) {
  const { db, ai, notify, setStage } = deps;
  const current = await db.botGet(conv.lead_id);
  if (current?.status !== 'active') return;

  if (current.ai_turns >= MAX_AI_TURNS) {
    await db.botTransition(conv.lead_id, ['active'], 'paused', 'turn_limit');
    await notify(`Bot pausou ${label(conv)}: a conversa chegou a ${MAX_AI_TURNS} respostas.`);
    return;
  }

  const history = await db.botHistory(conv.lead_id);
  let answer;
  try {
    answer = await ai(history, current);
  } catch (e) {
    await registerAiFailure(current, e, deps);
    return;
  }
  if (current.ai_first_fail) await db.botClearAiFailure(conv.lead_id);

  // Lorenzo pode ter assumido, ou o lead pode ter escrito de novo, enquanto a IA respondia.
  if ((await db.botGet(conv.lead_id))?.status !== 'active') return;
  const latest = await db.botHistory(conv.lead_id);
  if (latest.at(-1)?.id !== history.at(-1)?.id) return;

  if (answer.intent === 'opt_out') return optOut(current, deps, { speak: true });

  const discountAsks = answer.intent === 'discount' ? (current.discount_asks ?? 0) + 1 : 0;
  const said = history.filter((m) => m.source === 'bot').map((m) => m.body).join('\n');
  const decision = decide(answer, discountAsks, { said, niche: current.niche, name: current.name });
  if (decision.silent) {
    // Resposta automática: marca para não voltar à fila e espera uma pessoa escrever.
    const trailing = [];
    for (let i = history.length - 1; i >= 0 && history[i].direction === 'in'; i--) trailing.push(history[i].id);
    await db.botMarkAuto(trailing);
    return;
  }

  // Decisões que encerram a vez do bot são gravadas antes do envio.
  if (decision.status && !(await db.botTransition(conv.lead_id, ['active'], decision.status, decision.reason ?? null))) return;

  try {
    const id = await sendAndRecord(current, decision.text, deps, { allow: [decision.status ?? 'active'] });
    if (!id) return;
    await db.botIncrementTurn(conv.lead_id);
    if (answer.intent === 'discount') await db.botIncrementDiscount(conv.lead_id);
  } catch (e) {
    await sendFailure(current, e, deps);
    return;
  }

  if (decision.status === 'ready_to_close') {
    await setStage?.(current, 'qualificado');
    await notify(`${label(current)} aceitou. Envie os dados de pagamento do sinal e feche.`);
  } else if (decision.status === 'paused' || decision.status === 'closed') {
    await notify(`${label(current)} ${REASONS[decision.reason] ?? 'precisa de você'}.`);
  }
}

export async function handleInbound({ conv, id, text, hasText }, deps) {
  const { db, notify } = deps;
  // Webhook repetido depois de uma falha segue adiante: as transições abaixo são idempotentes.
  const auto = hasText && isAutoReply(text);
  await db.botAddMessage({ id, leadId: conv.lead_id, direction: 'in', source: auto ? 'auto' : 'lead', body: hasText ? text : '[mídia]' });
  // Antes das outras regras: "assistente virtual" no menu não é o lead perguntando se fala com um robô.
  if (auto || conv.status === 'opted_out') return;

  if (hasText && isOptOut(text)) {
    await optOut(conv, deps, { speak: conv.status === 'active' });
    return;
  }
  if (hasText && isBotQuestion(text) && await db.botTransition(conv.lead_id, ['active'], 'paused', 'asked_if_bot')) {
    await sendAndRecord(conv, FIXED.botQuestion, deps).catch((e) => console.error('[bot] resposta não enviada:', e.message));
    await notify(`${label(conv)} ${REASONS.asked_if_bot}.`);
    return;
  }
  if (!hasText && await db.botTransition(conv.lead_id, ['active'], 'paused', 'media')) {
    await notify(`${label(conv)} enviou áudio ou mídia. O bot pausou para você responder.`);
    return;
  }
  // Com o bot calado, o lead não pode ficar esperando sem Lorenzo saber. Depois que ele responde, já está no chat.
  if (['paused', 'ready_to_close'].includes(conv.status) && !(await db.botHistory(conv.lead_id)).some((m) => m.source === 'owner')) {
    const said = hasText ? `"${String(text).slice(0, 150)}"` : 'um áudio ou mídia';
    await notify(`${label(conv)} escreveu e está esperando você: ${said}`);
  }
}

import { sendAndRecord } from './engine.js';
import { firstMessage } from './offer.js';
import { mobileFromLead, phoneKey } from './phone.js';
import { hojeLocal } from '../date.js';

const WAIT_TO_REPLY_SEC = 30; // junta mensagens seguidas do mesmo lead
const CAPTURE_RETRY_MS = 60 * 60 * 1000;
const MAX_QUEUE = 50; // sem acumular mais do que se envia em alguns dias
const TICK_MS = 60 * 1000;

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

function canSendNow(now, { sendFrom = '09:00', sendTo = '18:00', weekdaysOnly = true }) {
  const day = now.getDay();
  if (weekdaysOnly && (day === 0 || day === 6)) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= minutes(sendFrom) && current < minutes(sendTo);
}

function withinLimits(now, limits, usage) {
  const today = usage?.date === hojeLocal(now) ? usage : { whatsapp: 0, lastAt: 0 };
  if ((today.whatsapp ?? 0) >= Number(limits?.whatsapp ?? 5)) return false;
  return now.getTime() - (today.lastAt ?? 0) >= Number(limits?.minSpacingMin ?? 8) * 60000;
}

async function capture(now, config, state, deps) {
  const today = hojeLocal(now);
  if (state?.lastCaptureDate === today) return;
  if (state?.lastCaptureAttempt && now.getTime() - state.lastCaptureAttempt < CAPTURE_RETRY_MS) return;
  await deps.saveState({ ...state, lastCaptureAttempt: now.getTime() });
  const { db } = deps;
  if (await db.botQueuedCount() >= MAX_QUEUE) return deps.saveState({ ...state, lastCaptureDate: today });

  for (const city of config.cities ?? []) {
    for (const niche of config.niches ?? []) {
      const { leads } = await deps.search({ niche, city: city.name, lat: city.lat, lng: city.lng, radiusKm: config.radiusKm ?? 5 });
      const candidates = leads
        .filter((lead) => !lead.hasWebsite)
        .map((lead) => ({ lead, phone: mobileFromLead(lead.phone) }))
        .filter((c) => c.phone);
      // Lead que já mudou de estágio foi trabalhado por Lorenzo e não recebe abordagem fria.
      const known = await deps.loadKnown(candidates.map((c) => c.lead.id));
      const fresh = [];
      for (const c of candidates) {
        const stage = known.get(c.lead.id)?.stage;
        if ((!stage || stage === 'novo') && !(await db.botGetByPhoneKey(phoneKey(c.phone)))) fresh.push(c);
      }
      if (!fresh.length) continue;
      const searchId = deps.createSearch(fresh.map((f) => f.lead), { city: city.name, niche, lat: city.lat, lng: city.lng, radiusKm: config.radiusKm ?? 5, found: leads.length });
      for (const { lead, phone } of fresh) {
        await db.botEnqueue({ leadId: lead.id, phone, phoneKey: phoneKey(phone), name: lead.name, niche, searchId });
      }
    }
  }
  await deps.saveState({ ...state, lastCaptureDate: today });
}

async function sendNext(now, config, settings, deps) {
  if (!canSendNow(now, config) || !withinLimits(now, settings.limits, settings.usage)) return;
  const { db, gateway } = deps;
  const conv = await db.botNextQueued();
  if (!conv || !(await db.botClaim(conv))) return;

  let id;
  try {
    if ((await gateway.state()) !== 'open') {
      await db.botTransition(conv.lead_id, ['sending'], 'queued');
      return deps.disableBot('whatsapp_disconnected');
    }
    if (!(await gateway.isOnWhatsApp(conv.phone))) {
      await db.botTransition(conv.lead_id, ['sending'], 'failed', 'not_on_whatsapp');
      return;
    }
  } catch (e) {
    console.error('[bot] falha no gateway:', e.message);
    await db.botTransition(conv.lead_id, ['sending'], 'queued');
    return deps.disableBot('send_failed');
  }
  try {
    // Conta antes de enviar: sem o registro, o limite anti-ban deixaria de valer.
    await db.incrementUsage('whatsapp', hojeLocal(now), now.getTime());
  } catch (e) {
    console.error('[bot] falha ao contar o envio:', e.message);
    await db.botTransition(conv.lead_id, ['sending'], 'queued');
    return;
  }
  try {
    const variant = conv.lead_id.length % 2 === 0 ? 'A' : 'B';
    id = await sendAndRecord(conv, firstMessage(variant, conv.name), deps, { allow: ['sending'] });
  } catch (e) {
    console.error('[bot] falha no envio:', e.message);
    // A mensagem pode ter saído: nunca reenvia sozinho.
    await db.botTransition(conv.lead_id, ['sending'], 'paused', 'send_failed');
    return deps.disableBot('send_failed');
  }
  if (!id) return;
  if (await db.botTransition(conv.lead_id, ['sending'], 'active')) await deps.setStage(conv, 'contatado');
}

const isEnabled = async (deps) => (await deps.settings())?.botConfig?.enabled === true;

export async function tick(now, deps) {
  if (!deps.dbEnabled()) return;
  for (const conv of await deps.db.botRecoverSending()) {
    await deps.notify(`O envio para ${conv.name ?? 'um lead'} (${conv.phone}) foi interrompido e pode ter saído. A conversa ficou pausada: confira no celular.`);
  }
  if (!(await isEnabled(deps))) return;

  for (const conv of await deps.db.botDueReplies(WAIT_TO_REPLY_SEC)) {
    if (!(await isEnabled(deps))) return;
    await deps.reply(conv);
  }
  const settings = await deps.settings();
  if (!settings?.botConfig?.enabled) return;
  try {
    await capture(now, settings.botConfig, settings.botState ?? {}, deps);
  } catch (e) {
    console.error('[bot] falha na captação:', e.message);
  }
  const latest = await deps.settings();
  if (latest?.botConfig?.enabled) await sendNext(now, latest.botConfig, latest, deps);
}

const DIGEST_MS = 5 * 60 * 1000;
const plural = (n, one, many) => (n === 1 ? one : many);
const names = (rows) => rows.map((r) => (r.niche ? `${r.name ?? 'sem nome'} (${r.niche})` : r.name ?? 'sem nome')).join(', ');

export function digestText({ contacted, replied, waiting }, minutes) {
  if (!contacted.length && !replied.length) return null;
  const parts = [];
  if (contacted.length) parts.push(`chamei ${contacted.length} ${plural(contacted.length, 'lead', 'leads')}: ${names(contacted)}.`);
  if (replied.length) {
    parts.push(`${replied.length} ${plural(replied.length, 'respondeu', 'responderam')} nos últimos ${minutes} min: ${names(replied)}.`);
  }
  parts.push(waiting ? `Ainda espero resposta de ${waiting}.` : 'Todos os contatados já responderam.');
  return `Lorenzo, ${parts.join(' ')}`;
}

// Resumo a cada 5 min, só quando há envio ou primeira resposta nova. Aceite e pausas já avisam na hora.
export async function sendDigest(now, deps) {
  if (!deps.dbEnabled()) return;
  const last = (await deps.settings())?.botDigestAt;
  if (last && now.getTime() - last < DIGEST_MS) return;
  await deps.saveDigestAt(now.getTime());
  if (!last) return; // primeira rodada só marca o início
  const text = digestText(await deps.db.botDigest(new Date(last)), Math.round((now.getTime() - last) / 60000));
  if (text) await deps.notify(text);
}

export function startScheduler(deps) {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick(new Date(), deps);
    } catch (e) {
      console.error('[bot] rotina:', e.message); // banco ou gateway fora: tenta no próximo minuto
    }
    try {
      await sendDigest(new Date(), deps);
    } catch (e) {
      console.error('[bot] resumo:', e.message);
    } finally {
      running = false;
    }
  }, TICK_MS).unref();
}

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
      const fresh = [];
      for (const lead of leads) {
        const phone = lead.hasWebsite ? null : mobileFromLead(lead.phone);
        if (phone && !(await db.botGetByPhoneKey(phoneKey(phone)))) fresh.push({ lead, phone });
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
  if (!conv) return;
  if ((await gateway.state()) !== 'open') return deps.disableBot('whatsapp_disconnected');
  try {
    if (!(await gateway.isOnWhatsApp(conv.phone))) {
      await db.botSetStatus(conv.lead_id, 'failed', 'not_on_whatsapp');
      return;
    }
    const variant = conv.lead_id.length % 2 === 0 ? 'A' : 'B';
    await sendAndRecord(conv, firstMessage(variant, conv.name), deps);
  } catch (e) {
    console.error('[bot] falha no envio:', e.message);
    return deps.disableBot('send_failed');
  }
  await db.incrementUsage('whatsapp', hojeLocal(now), now.getTime());
  await db.botSetStatus(conv.lead_id, 'active');
  await deps.setStage(conv, 'contatado');
}

export async function tick(now, deps) {
  if (!deps.dbEnabled()) return;
  const settings = await deps.settings();
  const config = settings?.botConfig;
  if (!config?.enabled) return;

  for (const conv of await deps.db.botDueReplies(WAIT_TO_REPLY_SEC)) await deps.reply(conv);
  try {
    await capture(now, config, settings.botState ?? {}, deps);
  } catch (e) {
    console.error('[bot] falha na captação:', e.message);
  }
  await sendNext(now, config, await deps.settings(), deps);
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
    } finally {
      running = false;
    }
  }, TICK_MS).unref();
}

import { sendAndRecord } from './engine.js';
import { firstMessage, FIXED } from './offer.js';
import { mobileFromLead, phoneKey } from './phone.js';
import { hojeLocal } from '../date.js';

const WAIT_TO_REPLY_SEC = 30; // junta mensagens seguidas do mesmo lead
const CAPTURE_RETRY_MS = 60 * 60 * 1000;
const MAX_QUEUE = 50; // sem acumular mais do que se envia em alguns dias
const TICK_MS = 60 * 1000;
// Busca de celular na internet: poucas por dia para o buscador não bloquear.
const MAX_ENRICH_PER_DAY = 15;

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

// Com "só dias úteis", o sábado ainda vale para quem abre no sábado (ver nextOpenOnSaturday).
const saturdayOnly = (now, config) => (config.weekdaysOnly ?? true) && now.getDay() === 6;

function canSendNow(now, { sendFrom = '09:00', sendTo = '18:00', weekdaysOnly = true }) {
  if (weekdaysOnly && now.getDay() === 0) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= minutes(sendFrom) && current < minutes(sendTo);
}

const usageToday = (now, usage) => (usage?.date === hojeLocal(now) ? usage : { whatsapp: 0, followup: 0, lastAt: 0 });

// O espaçamento vale para todo envio, novo ou lembrete.
const spaced = (now, limits, today) => now.getTime() - (today.lastAt ?? 0) >= Number(limits?.minSpacingMin ?? 8) * 60000;

const ddd = (phone) => phoneKey(phone).slice(0, 2);

function mostCommonDdd(leads) {
  const count = new Map();
  for (const l of leads) if (l.phone) count.set(ddd(l.phone), (count.get(ddd(l.phone)) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function capture(now, config, state, deps) {
  const today = hojeLocal(now);
  if (state?.lastCaptureDate === today) return;
  if (state?.lastCaptureAttempt && now.getTime() - state.lastCaptureAttempt < CAPTURE_RETRY_MS) return;
  await deps.saveState({ ...state, lastCaptureAttempt: now.getTime() });
  const { db } = deps;
  if (await db.botQueuedCount() >= MAX_QUEUE) return deps.saveState({ ...state, lastCaptureDate: today });

  let enrichLeft = MAX_ENRICH_PER_DAY;
  for (const city of config.cities ?? []) {
    for (const niche of config.niches ?? []) {
      const { leads } = await deps.search({ niche, city: city.name, lat: city.lat, lng: city.lng, radiusKm: config.radiusKm ?? 5 });
      const noSite = leads.filter((lead) => !lead.hasWebsite);
      const cityDdd = mostCommonDdd(leads);
      const known = await deps.loadKnown(noSite.map((l) => l.id));
      const fresh = [];
      const toEnrich = [];
      for (const lead of noSite) {
        const k = known.get(lead.id);
        // Lead que já mudou de estágio foi trabalhado por Lorenzo e não recebe abordagem fria.
        if (k?.stage && k.stage !== 'novo') continue;
        const found = k?.enrichmentStatus === 'done' ? k.enrichment : null;
        if (found?.discoveredWebsite) continue; // a busca achou site: não é lead quente
        const web = mobileFromLead(found?.mobilePhone);
        // Celular da internet de outro DDD costuma ser de outro negócio com nome parecido.
        const phone = mobileFromLead(lead.phone) ?? (web && ddd(web) === cityDdd ? web : null);
        if (phone) {
          if (!(await db.botGetByPhoneKey(phoneKey(phone)))) fresh.push({ lead, phone });
        } else if (!k?.enrichmentStatus || k.enrichmentStatus === 'pending' || k.enrichment?.partial) {
          // partial = o buscador bloqueou: não é um "não achou" de verdade.
          // Sem celular no mapa: procura na internet; o achado entra na captação do dia seguinte.
          if (enrichLeft-- > 0) toEnrich.push(lead);
        }
      }
      const meta = { city: city.name, niche, lat: city.lat, lng: city.lng, radiusKm: config.radiusKm ?? 5, found: leads.length };
      if (toEnrich.length) deps.createSearch(toEnrich, meta, { known, enrich: true });
      if (!fresh.length) continue;
      const searchId = deps.createSearch(fresh.map((f) => f.lead), meta, { known, enrich: false });
      for (const { lead, phone } of fresh) {
        await db.botEnqueue({ leadId: lead.id, phone, phoneKey: phoneKey(phone), name: lead.name, niche, searchId });
      }
    }
  }
  await deps.saveState({ ...state, lastCaptureDate: today });
}

export function businessDaysAgo(now, days) {
  const d = new Date(now);
  while (days > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) days--;
  }
  return d;
}

// Cadência anti-ban: 1º lembrete no dia útil seguinte, 2º e último 3 dias úteis depois do primeiro envio.
// Lembretes só à tarde: a manhã fica para os leads novos.
const FOLLOW_UP_AFTER_DAYS = [1, 3];
const FOLLOW_UP_TEXTS = [FIXED.followUp, FIXED.followUpLast];
const FOLLOW_UP_HOUR = 14;
const MAX_FOLLOW_UPS_PER_DAY = 10;

// Primeiro envio feito até o fim do dia de `businessDaysAgo`.
const sentUpTo = (now, days) => {
  const d = businessDaysAgo(now, days);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
};

async function sendFollowUp(now, conv, deps) {
  const { db, gateway } = deps;
  const step = conv.followups ?? 0;
  if (!(await db.botMarkFollowUp(conv.lead_id, step))) return;
  try {
    if ((await gateway.state()) !== 'open') return deps.disableBot('whatsapp_disconnected');
    // Cota própria: lembrete não tira a vaga de um lead novo.
    await db.incrementUsage('followup', hojeLocal(now), now.getTime());
    await sendAndRecord(conv, FOLLOW_UP_TEXTS[step], deps, { allow: ['active'] });
  } catch (e) {
    console.error('[bot] falha no lembrete:', e.message);
    await db.botTransition(conv.lead_id, ['active'], 'paused', 'send_failed');
    return deps.disableBot('send_failed');
  }
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Dias de uma regra do opening_hours ("Mo-Fr", "Tu-Sa", "Mo,We,Sa"); null se não entender.
function ruleCoversSaturday(days) {
  let covers = false;
  for (const token of days.split(',')) {
    if (token === 'PH' || token === 'SH') continue;
    const [a, b = a] = token.split('-').map((d) => DAYS.indexOf(d));
    if (a < 0 || b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) { if (d === 6) covers = true; if (d === b) break; }
  }
  return covers;
}

// Janelas de sábado em minutos, pela tag opening_hours do OSM. null = horário desconhecido ou ilegível.
// shortcut: entende só o formato comum (dias + horas); exceções por data/feriado são ignoradas.
export function saturdayWindows(oh) {
  if (!oh) return null;
  if (oh.trim() === '24/7') return [[0, 1440]];
  let windows = null;
  for (const raw of oh.split(';')) {
    const rule = raw.trim();
    const m = rule.match(/^(?:([A-Za-z,-]+)\s+)?(\d.*|off|closed)$/i);
    if (!m) continue;
    const covers = m[1] ? ruleCoversSaturday(m[1]) : true;
    if (!covers) continue; // regra de outro dia ou que não deu para ler
    windows = [...m[2].matchAll(/(\d{1,2}):(\d\d)\s*-\s*(\d{1,2}):(\d\d)/g)].map(([, h1, m1, h2, m2]) => {
      const end = Number(h2) * 60 + Number(m2);
      return [Number(h1) * 60 + Number(m1), end === 0 ? 1440 : end];
    }); // regra posterior vale sobre a anterior, como no OSM
  }
  return windows;
}

const SATURDAY_CLOSING_MARGIN_MIN = 30; // não chama quem está para fechar

// Próximo da fila que abre no sábado e está aberto agora. O horário vem do OSM, consultado no máximo 1x por hora.
async function nextOpenOnSaturday(now, deps) {
  const queued = await deps.db.botQueuedAll();
  const day = hojeLocal(now);
  if (deps.hoursCache?.date !== day) deps.hoursCache = { date: day, hours: new Map(), triedAt: 0 };
  const cache = deps.hoursCache;
  const missing = queued.map((c) => c.lead_id).filter((id) => !cache.hours.has(id));
  if (missing.length && now.getTime() - cache.triedAt >= CAPTURE_RETRY_MS) {
    cache.triedAt = now.getTime();
    try {
      const found = await deps.openingHours(missing);
      for (const id of missing) cache.hours.set(id, found.get(id) ?? null);
    } catch (e) {
      console.error('[bot] falha ao ler horários:', e.message);
    }
  }
  const t = now.getHours() * 60 + now.getMinutes();
  return queued.find((c) => (saturdayWindows(cache.hours.get(c.lead_id)) ?? [])
    .some(([from, to]) => t >= from && t <= to - SATURDAY_CLOSING_MARGIN_MIN)) ?? null;
}

// Se até a tarde quase ninguém dos leads de hoje respondeu (todos menos 1), chama mais 2 no mesmo dia.
const EXTRA_IF_SILENT = 2;
async function dailyLimit(now, settings, sent, db) {
  const base = Number(settings.limits?.whatsapp ?? 5);
  if (sent < base || now.getHours() < FOLLOW_UP_HOUR) return base;
  const silent = await db.botSilentSince(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  return silent >= base - 1 ? base + EXTRA_IF_SILENT : base;
}

async function sendNext(now, config, settings, deps) {
  const today = usageToday(now, settings.usage);
  if (!canSendNow(now, config) || !spaced(now, settings.limits, today)) return;
  const { db, gateway } = deps;
  const saturday = saturdayOnly(now, config);
  // Lembrete só em dia útil.
  if (!saturday && now.getHours() >= FOLLOW_UP_HOUR && (today.followup ?? 0) < MAX_FOLLOW_UPS_PER_DAY) {
    const due = await db.botDueFollowUp(FOLLOW_UP_AFTER_DAYS.map((days) => sentUpTo(now, days)));
    if (due) return sendFollowUp(now, due, deps);
  }
  if ((today.whatsapp ?? 0) >= (await dailyLimit(now, settings, today.whatsapp ?? 0, db))) return;
  const conv = saturday ? await nextOpenOnSaturday(now, deps) : await db.botNextQueued();
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

export function isThirdBusinessDay(now) {
  let count = 0;
  for (let day = 1; day <= now.getDate(); day++) {
    const weekday = new Date(now.getFullYear(), now.getMonth(), day).getDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  const today = now.getDay();
  return today !== 0 && today !== 6 && count === 3;
}

// shortcut: feriados contam como dia útil; se a data importar, usar um calendário de feriados.
export async function monthlyPurge(now, deps) {
  if (!deps.dbEnabled() || !isThirdBusinessDay(now)) return;
  const month = hojeLocal(now).slice(0, 7);
  if ((await deps.settings())?.botPurgedMonth === month) return;
  const { bot, evolution } = await deps.purgeMessages(new Date(now.getFullYear(), now.getMonth(), 1));
  await deps.savePurgedMonth(month);
  await deps.notify(`Limpeza do mês: apaguei ${bot} mensagens de conversas encerradas e ${evolution} cópias antigas do WhatsApp. Quem pediu para sair continua bloqueado.`);
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
    }
    try {
      await monthlyPurge(new Date(), deps);
    } catch (e) {
      console.error('[bot] limpeza:', e.message);
    } finally {
      running = false;
    }
  }, TICK_MS).unref();
}

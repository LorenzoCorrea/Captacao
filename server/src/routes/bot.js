import crypto from 'node:crypto';
import { Router } from 'express';
import { handleInbound, pendingSend } from '../bot/engine.js';
import { phoneKey } from '../bot/phone.js';
import { isLive } from '../bot/gateway.js';
import { DEFAULT_BOT_CONFIG } from '../bot/config.js';
import { hojeLocal } from '../date.js';

const IGNORED_CONTENT = new Set(['reactionMessage', 'protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'editedMessage', 'pollUpdateMessage']);

function readMessage(message = {}) {
  const text = message.conversation ?? message.extendedTextMessage?.text;
  if (typeof text === 'string') return { text, hasText: true };
  const kinds = Object.keys(message).filter((k) => !IGNORED_CONTENT.has(k));
  return kinds.length ? { text: '', hasText: false } : null;
}

// O número pode vir em remoteJid ou, com identificador @lid, em um campo alternativo.
function numberFromKey(key = {}) {
  const jid = [key.remoteJid, key.remoteJidAlt, key.senderPn].find((j) => /@s\.whatsapp\.net$/.test(j ?? ''));
  return jid ? jid.split('@')[0].split(':')[0] : null;
}

export async function handleWebhook(payload, deps) {
  const event = String(payload?.event ?? '').toLowerCase().replace(/_/g, '.');
  if (event === 'connection.update') {
    if (payload.data?.state === 'close') await deps.disableBot('whatsapp_disconnected');
    return;
  }
  if (event !== 'messages.upsert') return;

  const { key, message } = payload.data ?? {};
  if (!key?.id || /@(g\.us|broadcast|newsletter)$/.test(key.remoteJid ?? '')) return;
  const number = numberFromKey(key);
  if (!number) {
    console.warn('[bot] mensagem sem número identificável foi ignorada');
    return;
  }
  const { db } = deps;
  const conv = await db.botGetByPhoneKey(phoneKey(number));
  if (!conv) return;
  const content = readMessage(message);
  if (!content) return;

  if (key.fromMe) {
    // O eco do envio do bot pode chegar antes de o id ser gravado.
    await pendingSend(conv.phone_key).catch(() => {});
    if (await db.botHasMessage(key.id)) return;
    await db.botAddMessage({ id: key.id, leadId: conv.lead_id, direction: 'out', source: 'owner', body: content.hasText ? content.text : '[mídia]' });
    if (conv.status === 'active') await db.botSetStatus(conv.lead_id, 'paused', 'owner_replied');
    return;
  }
  await handleInbound({ conv, id: key.id, ...content }, deps);
}

function validConfig(body) {
  const time = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const { cities, niches, radiusKm, sendFrom, sendTo, weekdaysOnly } = body ?? {};
  const okCity = (c) => typeof c?.name === 'string' && Number.isFinite(c?.lat) && Math.abs(c.lat) <= 90 && Number.isFinite(c?.lng) && Math.abs(c.lng) <= 180;
  if (!Array.isArray(cities) || !cities.every(okCity) || !Array.isArray(niches) || !niches.every((n) => typeof n === 'string' && n.trim())) return null;
  if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 30 || !time(sendFrom) || !time(sendTo) || sendFrom >= sendTo || typeof weekdaysOnly !== 'boolean') return null;
  return { cities: cities.map(({ name, lat, lng }) => ({ name, lat, lng })), niches: niches.map((n) => n.trim()), radiusKm, sendFrom, sendTo, weekdaysOnly };
}

function sameSecret(given) {
  const expected = process.env.BOT_WEBHOOK_SECRET;
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createBotRouter(deps) {
  const router = Router();
  router.post('/api/bot/webhook/:secret', async (req, res) => {
    if (!sameSecret(req.params.secret)) return res.status(401).json({ error: 'Não autorizado.' });
    try {
      await handleWebhook(req.body, deps);
      res.json({ ok: true });
    } catch (e) {
      console.error('[bot] webhook:', e.message);
      res.status(500).json({ error: 'Falha ao processar.' });
    }
  });

  const guard = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      console.error('[bot] rota:', e.message);
      res.status(503).json({ error: 'Não consegui acessar o banco ou o WhatsApp agora.' });
    }
  };
  const { db, gateway } = deps;
  const withConversation = (handler) => guard(async (req, res) => {
    const conv = await db.botGet(req.params.leadId);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    return handler(conv, req, res);
  });

  router.get('/api/bot/status', guard(async (_req, res) => {
    const settings = (await deps.settings()) ?? {};
    const config = { ...DEFAULT_BOT_CONFIG, ...settings.botConfig };
    const usage = settings.usage?.date === hojeLocal() ? settings.usage : {};
    res.json({
      mode: isLive() ? 'live' : 'simulate',
      config,
      connection: await gateway.state(),
      sentToday: usage.whatsapp ?? 0,
      dailyLimit: Number(settings.limits?.whatsapp ?? 5),
    });
  }));

  router.get('/api/bot/conversations', guard(async (_req, res) => res.json({ conversations: await db.botList() })));
  router.get('/api/bot/conversations/:leadId', withConversation(async (conv, _req, res) => {
    res.json({ conversation: conv, messages: await db.botHistory(conv.lead_id) });
  }));

  router.post('/api/bot/conversations/:leadId/pause', withConversation(async (conv, _req, res) => {
    if (!['queued', 'active', 'ready_to_close'].includes(conv.status)) return res.status(409).json({ error: 'Esta conversa não pode ser pausada.' });
    await db.botSetStatus(conv.lead_id, 'paused', 'manual');
    res.json({ ok: true });
  }));

  router.post('/api/bot/conversations/:leadId/resume', withConversation(async (conv, _req, res) => {
    if (!['paused', 'ready_to_close'].includes(conv.status)) return res.status(409).json({ error: 'Esta conversa não pode voltar para o bot.' });
    await db.botClearAiFailure(conv.lead_id);
    await db.botSetStatus(conv.lead_id, 'active');
    res.json({ ok: true });
  }));

  router.post('/api/bot/conversations/:leadId/finish', withConversation(async (conv, req, res) => {
    if (typeof req.body?.won !== 'boolean') return res.status(400).json({ error: 'Informe se o negócio foi fechado.' });
    if (conv.status === 'opted_out') return res.status(409).json({ error: 'Este contato pediu para sair.' });
    await db.botSetStatus(conv.lead_id, 'closed', req.body.won ? 'won' : 'lost');
    await deps.setStage(conv, req.body.won ? 'ganho' : 'descartado');
    res.json({ ok: true });
  }));

  async function saveConfig(patch) {
    const current = (await deps.settings())?.botConfig ?? {};
    await db.saveSetting('botConfig', { ...DEFAULT_BOT_CONFIG, ...current, ...patch });
  }

  router.put('/api/bot/enabled', guard(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Valor inválido.' });
    if (req.body.enabled && (await gateway.state()) !== 'open') return res.status(409).json({ error: 'O número do WhatsApp está desconectado. Conecte antes de ligar o bot.' });
    await saveConfig({ enabled: req.body.enabled, disabledReason: null });
    res.json({ ok: true });
  }));

  router.put('/api/bot/config', guard(async (req, res) => {
    const patch = validConfig(req.body);
    if (!patch) return res.status(400).json({ error: 'Configuração inválida.' });
    await saveConfig(patch);
    res.json({ ok: true });
  }));

  router.post('/api/bot/connect', guard(async (_req, res) => res.json(await gateway.connect())));

  router.post('/api/bot/simulate-reply', guard(async (req, res) => {
    if (isLive()) return res.status(404).json({ error: 'Disponível só em simulação.' });
    const conv = await db.botGet(req.body?.leadId);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!conv || !text) return res.status(400).json({ error: 'Informe a conversa e o texto.' });
    await handleInbound({ conv, id: `sim-in-${crypto.randomUUID()}`, text, hasText: true }, deps);
    res.json({ ok: true });
  }));

  return router;
}

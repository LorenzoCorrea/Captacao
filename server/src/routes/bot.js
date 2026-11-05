import crypto from 'node:crypto';
import { Router } from 'express';
import { handleInbound, pendingSend } from '../bot/engine.js';
import { phoneKey } from '../bot/phone.js';

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
  return router;
}

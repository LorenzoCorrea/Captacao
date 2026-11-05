import pg from 'pg';
import * as db from '../db.js';
import { askAi } from './ai.js';
import { DEFAULT_BOT_CONFIG } from './config.js';
import { createGateway } from './gateway.js';
import { replyToLead } from './engine.js';
import { buscarEstabelecimentos } from '../data/osmProvider.js';
import { createSearch, updateLead } from '../enrichment/enricher.js';


const DISABLED_TEXT = {
  whatsapp_disconnected: 'o número desconectou',
  send_failed: 'houve falha no envio',
  owner_unresolved: 'não consegui identificar o contato de uma resposta sua',
};

// A Evolution guarda cópia de toda mensagem do número; o bot não lê esse histórico.
async function purgeEvolution(before) {
  if (!process.env.EVOLUTION_DATABASE_URI) return 0;
  const client = new pg.Client({ connectionString: process.env.EVOLUTION_DATABASE_URI });
  await client.connect();
  try {
    // Mídia e atualizações saem junto (ON DELETE CASCADE).
    const r = await client.query('DELETE FROM "Message" WHERE "messageTimestamp" < $1', [Math.floor(before.getTime() / 1000)]);
    return r.rowCount;
  } finally {
    await client.end();
  }
}

export function createRuntime() {
  const gateway = createGateway();

  async function notify(text) {
    const owner = process.env.OWNER_WHATSAPP;
    console.log('[bot] aviso:', text);
    if (!owner) return;
    // O aviso não pode interromper a conversa nem o desligamento do bot.
    await gateway.send(owner, `🤖 ${text}`).catch((e) => console.error('[bot] aviso não enviado:', e.message));
  }

  const settings = () => db.loadSettings();

  async function disableBot(reason) {
    const current = (await settings())?.botConfig ?? DEFAULT_BOT_CONFIG;
    await db.saveSetting('botConfig', { ...current, enabled: false, disabledReason: reason });
    await notify(`O bot foi desligado: ${DISABLED_TEXT[reason] ?? reason}.`);
  }

  const deps = {
    db,
    gateway,
    notify,
    disableBot,
    settings,
    ai: askAi,
    dbEnabled: () => db.dbEnabled,
    saveState: (state) => db.saveSetting('botState', state),
    saveDigestAt: (at) => db.saveSetting('botDigestAt', at),
    savePurgedMonth: (month) => db.saveSetting('botPurgedMonth', month),
    purgeMessages: async (before) => ({ bot: await db.botPurgeMessages(before), evolution: await purgeEvolution(before) }),
    search: buscarEstabelecimentos,
    loadKnown: db.loadKnownLeads,
    createSearch: (leads, meta, { known, enrich }) => createSearch(leads, meta, known, { enrich }),
    // Sem link público (Funnel) ou sem busca salva, o bot não oferece a prévia.
    previewUrl: (conv) => (process.env.PUBLIC_PREVIEW_URL && conv.search_id
      ? `${process.env.PUBLIC_PREVIEW_URL.replace(/\/+$/, '')}/previa/${conv.search_id}/${encodeURIComponent(conv.lead_id)}`
      : null),
    setStage: (conv, stage) => (conv.search_id ? updateLead(conv.search_id, conv.lead_id, { stage }) : Promise.resolve(false)),
  };
  deps.reply = (conv) => replyToLead(conv, { ...deps, now: () => new Date() });
  return deps;
}

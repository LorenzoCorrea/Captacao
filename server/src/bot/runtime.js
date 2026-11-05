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
    search: buscarEstabelecimentos,
    loadKnown: db.loadKnownLeads,
    createSearch: (leads, meta) => createSearch(leads, meta, new Map(), { enrich: false }),
    setStage: (conv, stage) => (conv.search_id ? updateLead(conv.search_id, conv.lead_id, { stage }) : Promise.resolve(false)),
  };
  deps.reply = (conv) => replyToLead(conv, { ...deps, now: () => new Date() });
  return deps;
}

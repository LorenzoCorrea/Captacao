import * as db from '../db.js';
import { askAi } from './ai.js';
import { DEFAULT_BOT_CONFIG } from './config.js';
import { createGateway } from './gateway.js';
import { replyToLead } from './engine.js';
import { buscarEstabelecimentos } from '../data/osmProvider.js';
import { createSearch, updateLead } from '../enrichment/enricher.js';


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
    await notify(`O bot foi desligado: ${reason === 'whatsapp_disconnected' ? 'o número desconectou' : 'houve falha no envio'}.`);
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
    createSearch: (leads, meta) => createSearch(leads, meta, new Map(), { enrich: false }),
    setStage: (conv, stage) => (conv.search_id ? updateLead(conv.search_id, conv.lead_id, { stage }) : Promise.resolve(false)),
  };
  deps.reply = (conv) => replyToLead(conv, { ...deps, now: () => new Date() });
  return deps;
}

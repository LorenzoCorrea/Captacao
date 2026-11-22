import crypto from 'node:crypto';

const TIMEOUT_MS = 20000;

async function evolution(path, { method = 'GET', body, timeout = TIMEOUT_MS } = {}) {
  const r = await fetch(`${process.env.EVOLUTION_URL}${path}`, {
    method,
    signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Evolution respondeu HTTP ${r.status} em ${path.split('/').slice(0, 3).join('/')}`);
  return r.json();
}

const instance = () => encodeURIComponent(process.env.EVOLUTION_INSTANCE);

// Fora de BOT_MODE=live nada sai pelo WhatsApp.
export const isLive = () => process.env.BOT_MODE === 'live';

export function createGateway() {
  return {
    async send(phone, text) {
      if (!isLive()) return `sim-${crypto.randomUUID()}`;
      const data = await evolution(`/message/sendText/${instance()}`, { method: 'POST', body: { number: phone, text } });
      const id = data?.key?.id;
      if (!id) throw new Error('Evolution não retornou o id da mensagem');
      return id;
    },
    // PDF como documento, com legenda. Arquivos de alguns MB levam mais que um texto.
    async sendDocument(phone, { pdf, fileName, caption }) {
      if (!isLive()) return `sim-${crypto.randomUUID()}`;
      const body = { number: phone, mediatype: 'document', mimetype: 'application/pdf', media: pdf.toString('base64'), fileName, caption };
      const data = await evolution(`/message/sendMedia/${instance()}`, { method: 'POST', body, timeout: 60000 });
      const id = data?.key?.id;
      if (!id) throw new Error('Evolution não retornou o id da mensagem');
      return id;
    },
    async isOnWhatsApp(phone) {
      if (!isLive()) return true;
      const data = await evolution(`/chat/whatsappNumbers/${instance()}`, { method: 'POST', body: { numbers: [phone] } });
      return Boolean(data?.[0]?.exists);
    },
    // Em simulação o bot age como conectado, mas a tela mostra o pareamento real.
    async state() {
      return isLive() ? this.linkState() : 'open';
    },
    async linkState() {
      try {
        const data = await evolution(`/instance/connectionState/${instance()}`);
        return data?.instance?.state ?? 'close';
      } catch {
        return 'close';
      }
    },
    // Cria a instância se preciso, aponta o webhook para a API e devolve o QR code.
    async connect() {
      const webhook = {
        url: `http://api:3001/api/bot/webhook/${process.env.BOT_WEBHOOK_SECRET}`,
        enabled: true, byEvents: false, base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      };
      try {
        await evolution('/instance/create', { method: 'POST', body: { instanceName: process.env.EVOLUTION_INSTANCE, integration: 'WHATSAPP-BAILEYS', qrcode: true, webhook } });
      } catch (e) {
        if (!/HTTP 403/.test(e.message)) throw e; // 403: a instância já existe
        await evolution(`/webhook/set/${instance()}`, { method: 'POST', body: { webhook } });
      }
      const data = await evolution(`/instance/connect/${instance()}`);
      return { qr: data?.base64 ?? null };
    },
  };
}

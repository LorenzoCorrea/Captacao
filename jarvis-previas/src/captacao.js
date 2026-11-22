// Cliente da API do Captação (pelo nginx, com o login do site).
const PODE_RECEBER = new Set(['active', 'paused', 'ready_to_close']);

export function createCaptacao({ url, auth, fetch = globalThis.fetch }) {
  const headers = { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` };

  return {
    // Só quem já conversa com o bot e não saiu; quem pediu prévia vem primeiro.
    async leads() {
      const r = await fetch(`${url}/api/bot/conversations`, { headers: { ...headers } });
      if (!r.ok) throw new Error(`Captação respondeu HTTP ${r.status}`);
      const { conversations = [] } = await r.json();
      return conversations
        .filter((c) => PODE_RECEBER.has(c.status))
        .map((c) => ({
          leadId: c.lead_id, name: c.name ?? c.phone, phone: c.phone, pediuPrevia: c.status === 'paused' && c.reason === 'preview_requested',
          niche: c.niche ?? null, address: c.address ?? null, city: c.city ?? null, pausadoEm: Date.parse(c.updated_at),
        }))
        .sort((a, b) => Number(b.pediuPrevia) - Number(a.pediuPrevia) || a.name.localeCompare(b.name, 'pt-BR'));
    },
    // Chamada genérica para as ferramentas do Jarvis de voz.
    async api(method, path, body) {
      const r = await fetch(`${url}${path}`, {
        method,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.error ?? `Captação respondeu HTTP ${r.status}`);
      return dados;
    },
    // Foto de perfil do WhatsApp do lead; null quando ele não tem.
    async photo(leadId) {
      const r = await fetch(`${url}/api/bot/conversations/${encodeURIComponent(leadId)}/photo`, { headers: { ...headers }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Captação respondeu HTTP ${r.status}`);
      return { buffer: Buffer.from(await r.arrayBuffer()), type: (r.headers.get('content-type') ?? '').split(';')[0] };
    },
    async previewReady(leadId) {
      await this.api('POST', `/api/bot/conversations/${encodeURIComponent(leadId)}/preview-ready`);
    },
    async sendPreview(leadId, pdf, fileName) {
      const r = await fetch(`${url}/api/bot/conversations/${encodeURIComponent(leadId)}/preview?file=${encodeURIComponent(fileName)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/pdf' },
        body: pdf,
        signal: AbortSignal.timeout(120000),
      });
      if (r.ok) return { ok: true };
      const body = await r.json().catch(() => ({}));
      return { ok: false, status: r.status, error: body.error ?? `HTTP ${r.status}` };
    },
  };
}

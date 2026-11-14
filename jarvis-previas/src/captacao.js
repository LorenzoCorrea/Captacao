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
        .map((c) => ({ leadId: c.lead_id, name: c.name ?? c.phone, phone: c.phone, pediuPrevia: c.status === 'paused' && c.reason === 'preview_requested' }))
        .sort((a, b) => Number(b.pediuPrevia) - Number(a.pediuPrevia) || a.name.localeCompare(b.name, 'pt-BR'));
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

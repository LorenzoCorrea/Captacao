// Envio aprovado: lê o lead do registro (nunca de arquivo que o agente escreve) e manda o PDF pelo Captação.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ID = /^[a-z0-9]{8}$/;
const PODE_ENVIAR = new Set(['montando', 'previa_pronta', 'enviado']);

const nomeArquivo = (nome) => {
  const slug = String(nome ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45);
  return `Previa${slug ? `-${slug}` : ''}.pdf`;
};

export async function enviar({ id, store, captacao, jobsDir, now = Date.now }) {
  const p = ID.test(String(id)) ? store.get(id) : undefined;
  if (!p) return { ok: false, motivo: 'pedido inválido' };
  if (!PODE_ENVIAR.has(p.estado)) return { ok: false, motivo: `o pedido está "${p.estado}" e não pode ser enviado` };
  const file = join(jobsDir, id, 'saida', 'previa.pdf');
  const pdf = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  if (!pdf.length) return { ok: false, motivo: 'falta o saida/previa.pdf: rode o gerar-pdf antes' };
  const hash = createHash('sha256').update(pdf).digest('hex');
  if (hash === p.enviadoHash) return { ok: false, motivo: 'esta prévia já foi enviada' };

  const r = await captacao.sendPreview(p.leadId, pdf, nomeArquivo(p.leadName));
  if (r.ok) {
    store.update(id, { estado: 'enviado', enviadoHash: hash, enviadoEm: now() });
    return { ok: true };
  }
  // 409: o lead saiu da conversa; outras falhas podem ser passageiras e permitem tentar de novo.
  if (r.status === 409) store.update(id, { estado: 'erro', erro: r.error });
  return { ok: false, motivo: r.error };
}

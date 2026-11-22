// Pedidos automáticos: quem pediu a prévia ao bot ganha um pedido sem o Lorenzo fazer nada.
// O envio continua dependendo da aprovação dele no app; aqui só se abre o pedido e se avisa.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RECENTE = 48 * 60 * 60 * 1000; // pedidos de prévia mais antigos já esfriaram
const REENVIO = 30 * 24 * 60 * 60 * 1000;
const ABERTOS = new Set(['recebendo', 'na_fila', 'montando', 'previa_pronta']);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const OBSERVACAO = 'Pedido automático: sem fotos do Lorenzo. Use a foto de perfil (se houver) como logo.';

// lead.json do pedido; campos vazios ficam de fora para o agente não inventar em cima deles.
export function escreverLead(dir, lead, observacao) {
  const dados = { nome: lead.name, telefone: lead.phone, ramo: lead.niche, endereco: lead.address, cidade: lead.city, observacao };
  for (const k of Object.keys(dados)) if (dados[k] == null || dados[k] === '') delete dados[k];
  if (!('observacao' in dados)) dados.observacao = '';
  writeFileSync(join(dir, 'lead.json'), JSON.stringify(dados, null, 2));
}

export function createAuto({ store, captacao, jobsDir, now = Date.now }) {
  const jaTem = (leadId, t) => store.list().some((p) => p.leadId === leadId && !p.apagado
    && (ABERTOS.has(p.estado) || (p.estado === 'enviado' && t - p.enviadoEm < REENVIO)));

  async function criar(lead) {
    const p = store.create({ leadId: lead.leadId, leadName: lead.name, phone: lead.phone, observacao: OBSERVACAO });
    const dir = join(jobsDir, p.id);
    mkdirSync(join(dir, 'fotos'), { recursive: true });
    escreverLead(dir, lead, OBSERVACAO);
    let fotos = 0;
    try {
      const foto = await captacao.photo(lead.leadId);
      if (foto && EXT[foto.type]) {
        writeFileSync(join(dir, 'fotos', `01.${EXT[foto.type]}`), foto.buffer);
        fotos = 1;
      }
    } catch (e) {
      console.error('[jarvis-previas] auto: foto de perfil:', e.message);
    }
    store.update(p.id, { automatico: true, fotos, estado: 'na_fila' });
  }

  async function abrirPedidos() {
    const t = now();
    for (const lead of await captacao.leads()) {
      if (!lead.pediuPrevia || !(t - lead.pausadoEm <= RECENTE) || jaTem(lead.leadId, t)) continue;
      await criar(lead);
    }
  }

  async function avisarProntas() {
    for (const p of store.list()) {
      if (!p.aguardandoAprovacao || p.avisadoEm) continue;
      // Falhou: tenta de novo no próximo passo, sem travar os outros pedidos.
      try {
        await captacao.previewReady(p.leadId);
        store.update(p.id, { avisadoEm: now() });
      } catch (e) {
        console.error(`[jarvis-previas] auto: aviso do pedido ${p.id}:`, e.message);
      }
    }
  }

  return {
    async passo() {
      for (const etapa of [abrirPedidos, avisarProntas]) {
        try { await etapa(); } catch (e) { console.error('[jarvis-previas] auto:', e.message); }
      }
    },
  };
}

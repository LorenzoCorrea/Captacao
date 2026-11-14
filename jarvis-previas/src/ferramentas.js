// Ferramentas do Jarvis de voz: consultar (livre) e agir (só depois da aprovação do Lorenzo).
// Roda como lorenzo (bin/jarvis-lorenzo); o mordomo só chega aqui pelos wrappers em /srv/jarvis-voz/bin.
// O texto devolvido é o que o Claude lê: curto, uma informação por linha.

export const SERVICOS = ['jarvis-previas', 'habblaud', 'captacao-web-1', 'captacao-api-1', 'captacao-evolution-1', 'captacao-router9-1', 'captacao-searxng-1'];
const ID_PEDIDO = /^[a-z0-9]{8}$/;
const conv = (id) => `/api/bot/conversations/${encodeURIComponent(id)}`;
const data = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const EXTRA_MAX = 20;

export function createFerramentas({ captacao, store, sistema, previas, log, hoje = hojeSP }) {
  const conversas = async () => (await captacao.api('GET', '/api/bot/conversations')).conversations ?? [];
  const exigeLead = async (id) => {
    if (!id) throw new Error('Informe o lead_id (use: consultar conversas).');
    const c = (await conversas()).find((x) => x.lead_id === id);
    if (!c) throw new Error(`Lead não encontrado: ${id}`);
    return c;
  };

  const assuntos = {
    async bot() {
      const [s, { settings = {} }] = await Promise.all([captacao.api('GET', '/api/bot/status'), captacao.api('GET', '/api/settings')]);
      const extra = settings.extraHoje?.date === hoje() ? Number(settings.extraHoje.n) || 0 : 0;
      const c = s.config ?? {};
      return [
        `Bot ${s.config?.enabled ? 'ligado' : 'desligado'}${s.config?.disabledReason ? ` (${s.config.disabledReason})` : ''}, modo ${s.mode === 'live' ? 'real' : 'simulação'}.`,
        `WhatsApp ${s.connection === 'open' ? 'conectado' : `não conectado (${s.connection})`}.`,
        `Enviados hoje: ${s.sentToday} de ${s.dailyLimit + extra}${extra ? ` (${s.dailyLimit} de sempre + ${extra} a mais hoje)` : ''}.`,
        `Envia das ${c.sendFrom ?? '09:00'} às ${c.sendTo ?? '18:00'}${c.weekdaysOnly ? ', em dia útil (sábado só para quem está aberto)' : ''}.`,
      ].join('\n');
    },
    async conversas([status]) {
      const lista = (await conversas()).filter((c) => !status || c.status === status);
      if (!lista.length) return status ? `Nenhuma conversa com status ${status}.` : 'Nenhuma conversa.';
      const contagem = Object.entries(Object.groupBy(lista, (c) => c.status)).map(([k, v]) => `${k}: ${v.length}`).join(', ');
      return [`${lista.length} conversa(s) (${contagem}).`, ...lista.slice(0, 40).map((c) => `${c.name ?? c.phone} · ${c.lead_id} · ${c.status}${c.reason ? ` · ${c.reason}` : ''}`)].join('\n');
    },
    async conversa([id]) {
      await exigeLead(id);
      const { conversation: c, messages = [] } = await captacao.api('GET', conv(id));
      return [`${c.name ?? c.phone} · ${c.status}${c.reason ? ` · ${c.reason}` : ''}`,
        ...messages.slice(-5).map((m) => `[${data(m.created_at)}] ${m.direction === 'in' ? 'Lead' : 'Bot'}: ${String(m.body).slice(0, 300)}`)].join('\n');
    },
    async hoje() {
      const [{ items = [] }, { stats }] = await Promise.all([captacao.api('GET', '/api/today'), captacao.api('GET', '/api/stats')]);
      const g = stats?.geral ?? {};
      return [`Leads para hoje: ${items.length}${items.length ? ` (${items.slice(0, 5).map((i) => i.name).join(', ')}${items.length > 5 ? '…' : ''})` : ''}.`,
        `Total: ${g.total} leads, ${g.contatado} contatados, ${g.qualificado} qualificados, ${g.ganho} ganhos, ${g.descartado} descartados, ${g.buscas} buscas.`].join('\n');
    },
    async buscas() {
      const { searches = [] } = await captacao.api('GET', '/api/searches');
      return searches.slice(0, 5).map((s) => `${data(s.created_at)} · ${s.niche} em ${s.city} · ${s.found} encontrados, ${s.leads} leads`).join('\n') || 'Nenhuma busca.';
    },
    async pedidos() {
      const lista = store.list().filter((p) => !p.apagado);
      return lista.map((p) => `${p.id} · ${p.leadName} · ${p.estado}${p.erro ? ` · ${p.erro}` : ''}`).join('\n') || 'Nenhum pedido de prévia.';
    },
    async servidor() {
      return Object.entries(await sistema.servicos()).map(([k, v]) => `${k}: ${v}`).join('\n');
    },
  };

  const acoes = {
    async pausar([id]) { await exigeLead(id); await captacao.api('POST', `${conv(id)}/pause`); return 'Conversa pausada.'; },
    async retomar([id]) { await exigeLead(id); await captacao.api('POST', `${conv(id)}/resume`); return 'Conversa de volta com o bot.'; },
    async encerrar([id, resultado]) {
      if (!['ganho', 'perdido'].includes(resultado)) throw new Error('Use ganho ou perdido.');
      await exigeLead(id);
      await captacao.api('POST', `${conv(id)}/finish`, { won: resultado === 'ganho' });
      return `Conversa encerrada como ${resultado}.`;
    },
    async bot([o]) {
      if (!['ligar', 'desligar'].includes(o)) throw new Error('Use ligar ou desligar.');
      await captacao.api('PUT', '/api/bot/enabled', { enabled: o === 'ligar' });
      return `Bot ${o === 'ligar' ? 'ligado' : 'desligado'}.`;
    },
    // "Chame mais N leads hoje": soma ao limite só no dia (o bot zera sozinho amanhã).
    async 'chamar-mais'([n]) {
      const mais = Number(n);
      if (!Number.isInteger(mais) || mais < 1 || mais > 10) throw new Error('Peça de 1 a 10 leads a mais por vez.');
      const { settings = {} } = await captacao.api('GET', '/api/settings');
      const atual = settings.extraHoje?.date === hoje() ? Number(settings.extraHoje.n) || 0 : 0;
      if (atual + mais > EXTRA_MAX) throw new Error(`Hoje já há ${atual} a mais; o extra vai no máximo 20 por dia.`);
      await captacao.api('PUT', '/api/settings/extraHoje', { value: { date: hoje(), n: atual + mais } });
      const base = Number(settings.limits?.whatsapp ?? 5);
      return `Limite de hoje: ${base + atual + mais} hoje (${base} de sempre + ${atual + mais} a mais). O bot envia no horário configurado, com intervalo entre mensagens, e o extra zera amanhã.`;
    },
    async 'apagar-pedido'([id]) {
      if (!ID_PEDIDO.test(id ?? '')) throw new Error('Pedido inválido.');
      await previas.apagar(id);
      return 'Pedido apagado.';
    },
    async reiniciar([nome]) {
      if (!SERVICOS.includes(nome)) throw new Error(`Serviço fora da lista: ${nome}. Pode: ${SERVICOS.join(', ')}.`);
      await sistema.reiniciar(nome);
      return `${nome} reiniciado.`;
    },
  };

  return {
    async consultar(assunto, args) {
      if (!Object.hasOwn(assuntos, assunto)) throw new Error(`Assunto desconhecido: ${assunto}. Pode: ${Object.keys(assuntos).join(', ')}.`);
      return assuntos[assunto](args);
    },
    async agir(acao, args) {
      if (!Object.hasOwn(acoes, acao)) throw new Error(`Ação desconhecida: ${acao}. Pode: ${Object.keys(acoes).join(', ')}.`);
      try {
        const saida = await acoes[acao](args);
        log({ em: Date.now(), acao, args, ok: true, saida });
        return saida;
      } catch (e) {
        log({ em: Date.now(), acao, args, ok: false, saida: e.message });
        throw e;
      }
    },
  };
}

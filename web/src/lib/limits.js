// Proteção anti-ban ("modo aquecimento").
//
// O WhatsApp bane número que dispara mensagem fria em volume — e número NOVO
// é o mais frágil de todos: sem histórico, o anti-spam assume o pior a cada
// envio. Aqui impomos um teto DIÁRIO por canal e um espaçamento mínimo entre
// envios; o modo disparo respeita os dois. Config e contadores ficam no
// navegador (localStorage), zerando sozinhos a cada dia.

const CFG_KEY = 'captacao.limits';
const USE_KEY = 'captacao.usage';

// Padrões pensados para número recém-criado. Suba devagar (veja AQUECIMENTO).
export const DEFAULT_LIMITS = {
  whatsapp: 5,
  instagram: 8,
  minSpacingMin: 8, // minutos entre um envio e o próximo
};

export const AQUECIMENTO = [
  'Semana 1 — até 5/dia. Use o número normalmente também: fale com contatos reais, receba respostas.',
  'Semana 2 — 10/dia, se ninguém bloqueou/denunciou.',
  'Semana 3 — 15/dia.',
  'Semana 4+ — 20/dia, só se a taxa de resposta estiver saudável.',
];

const hoje = () => new Date().toISOString().slice(0, 10);
const ler = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
};
const gravar = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ }
};

export const loadLimits = () => ler(CFG_KEY, DEFAULT_LIMITS);
export const saveLimits = (cfg) => gravar(CFG_KEY, { ...DEFAULT_LIMITS, ...cfg });

// Contadores do dia. Vira o dia -> zera (sem precisar de cron nem servidor).
export function getUsage() {
  const u = ler(USE_KEY, { date: hoje(), whatsapp: 0, instagram: 0, lastAt: 0 });
  if (u.date !== hoje()) return { date: hoje(), whatsapp: 0, instagram: 0, lastAt: 0 };
  return u;
}

export function registerSend(canal) {
  const u = getUsage();
  const next = { ...u, [canal]: (u[canal] ?? 0) + 1, lastAt: Date.now() };
  gravar(USE_KEY, next);
  return next;
}

// Pode enviar agora? Devolve motivo e quanto falta — a UI usa para travar o
// botão e mostrar o contador, em vez de deixar o usuário no escuro.
export function checkSend(canal, cfg = loadLimits(), usage = getUsage()) {
  const teto = Number(cfg[canal] ?? 0);
  const usados = usage[canal] ?? 0;
  const restantes = Math.max(0, teto - usados);
  if (restantes <= 0) {
    return { ok: false, restantes: 0, usados, teto, motivo: 'limite-diario' };
  }
  const esperaMs = Number(cfg.minSpacingMin ?? 0) * 60000 - (Date.now() - (usage.lastAt || 0));
  if (usage.lastAt && esperaMs > 0) {
    return { ok: false, restantes, usados, teto, motivo: 'espacamento', esperaSeg: Math.ceil(esperaMs / 1000) };
  }
  return { ok: true, restantes, usados, teto };
}

export const fmtEspera = (seg) => {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return m > 0 ? `${m}min ${String(s).padStart(2, '0')}s` : `${s}s`;
};

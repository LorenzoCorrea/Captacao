// Monta o link wa.me com a mensagem de abordagem já preenchida e personalizada
// por nicho. A mensagem é EDITÁVEL pela tela (componente MessageSettings) e fica
// salva no navegador (localStorage); aqui mora o conteúdo padrão de fábrica.
// Limite de leads por disparo em massa (evita derrubar/bloquear o número).
export const WA_LIMIT = 10;

const norm = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// ── Conteúdo padrão (usado enquanto o usuário não personaliza) ──
// O template aceita as variáveis {nome} e {beneficio}.
const DEFAULT_TEMPLATE = `Oi, {nome}, tudo bem? Aqui é o Lorenzo!

Sou desenvolvedor web e ajudo negócios a se posicionarem melhor na internet. Estava dando uma olhada no perfil de vocês e tive uma ideia: {beneficio}.

Faz sentido conversarmos rapidinho sobre isso? Posso te mandar um áudio curto explicando melhor a ideia? 😉`;

// Gancho de valor por ramo. `kw` são radicais SEM acento (casam por substring).
const DEFAULT_BENEFICIOS = [
  { kw: ['estetic', 'beleza', 'salao', 'barbear', 'manicure', 'sobrancelha', 'cabelei', 'spa', 'unha', 'depila'], txt: 'um site com agendamento online poderia encher a agenda de vocês e atrair mais clientes' },
  { kw: ['restaurante', 'lanchonete', 'pizz', 'hamburg', 'cafe', 'bar', 'bistro', 'padaria', 'comida', 'gastr'], txt: 'um site com cardápio digital e pedidos online poderia trazer mais clientes e facilitar o delivery' },
  { kw: ['advog', 'advocacia', 'jurid'], txt: 'um site profissional poderia passar mais credibilidade e captar mais clientes pro escritório' },
  { kw: ['clinic', 'consultor', 'medic', 'saude', 'dent', 'odonto', 'fisio', 'psicol'], txt: 'um site com agendamento poderia atrair mais pacientes e organizar os atendimentos' },
  { kw: ['nutri'], txt: 'um site poderia atrair mais pacientes e mostrar seu trabalho com mais autoridade' },
  { kw: ['academia', 'fitness', 'pilates', 'crossfit', 'muscula'], txt: 'um site poderia atrair mais alunos e facilitar as matrículas' },
  { kw: ['pet', 'veterin'], txt: 'um site poderia atrair mais clientes e facilitar os agendamentos' },
  { kw: ['contab', 'contador'], txt: 'um site profissional poderia passar mais credibilidade e captar mais clientes' },
  { kw: ['imobili', 'corretor', 'imovel'], txt: 'um site com os imóveis de vocês poderia gerar mais contatos e fechar mais negócios' },
];
const DEFAULT_BENEFICIO_PADRAO = 'um site profissional poderia ajudar vocês a atrair mais clientes e automatizar o atendimento';

export const DEFAULT_MSG_CONFIG = {
  template: DEFAULT_TEMPLATE,
  templateB: '', // variante B do teste A/B (vazio = A/B desligado)
  beneficios: DEFAULT_BENEFICIOS,
  beneficioPadrao: DEFAULT_BENEFICIO_PADRAO,
};

// ── Persistência da config no navegador ──
const STORAGE_KEY = 'captacao.msgConfig';

export function loadMsgConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_MSG_CONFIG, ...JSON.parse(raw) };
  } catch { /* localStorage indisponível: usa o padrão */ }
  return DEFAULT_MSG_CONFIG;
}

export function saveMsgConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* ignora */ }
}

export function resetMsgConfig() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignora */ }
}

// Conversões entre o array de benefícios e o texto editável (1 regra por linha:
// "palavra1, palavra2 => texto do benefício").
export function beneficiosToText(beneficios) {
  return beneficios.map((b) => `${b.kw.join(', ')} => ${b.txt}`).join('\n');
}
export function beneficiosFromText(text) {
  return (text || '')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('=>');
      if (i < 0) return null;
      const kw = line.slice(0, i).split(',').map((s) => norm(s.trim())).filter(Boolean);
      const txt = line.slice(i + 2).trim();
      return kw.length && txt ? { kw, txt } : null;
    })
    .filter(Boolean);
}

function beneficio(niche, cfg) {
  const n = norm(niche);
  return (cfg.beneficios.find((b) => b.kw.some((k) => n.includes(k))) || {}).txt || cfg.beneficioPadrao;
}

// Primeiro nome do sócio (do CNPJ) para abordagem nominal: "GILBERTO DA SILVA" -> "Gilberto"
export function primeiroNome(fullName) {
  const p = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
}

// Teste A/B: com a variante B preenchida, cada lead recebe SEMPRE a mesma
// variante (hash determinístico do id) — metade A, metade B. O painel de
// stats mostra qual converte mais.
export function variantOf(leadId, cfg = loadMsgConfig()) {
  const c = cfg ?? loadMsgConfig();
  if (!c.templateB?.trim()) return 'A';
  let h = 0;
  for (const ch of String(leadId ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? 'A' : 'B';
}

// Monta a mensagem final aplicando a config (personalizada ou padrão).
// {dono} vira o primeiro nome do sócio (via CNPJ); sem sócio, cai no nome do negócio.
export function montarMensagem(nome, niche, cfg = loadMsgConfig(), dono = '', leadId = '') {
  const c = cfg ?? loadMsgConfig();
  const tpl = variantOf(leadId, c) === 'B' ? c.templateB : (c.template || DEFAULT_TEMPLATE);
  return tpl
    .replaceAll('{nome}', nome ?? '')
    .replaceAll('{dono}', primeiroNome(dono) || nome || '')
    .replaceAll('{beneficio}', beneficio(niche, c));
}

// Normaliza telefone BR para o formato do wa.me (DDI 55 + DDD + número, só dígitos).
export function normalizePhoneBR(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length < 10) return null; // sem DDD não dá pra montar
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return '55' + d;
}

export function waLink(phone, nome, niche, dono = '', leadId = '') {
  const d = normalizePhoneBR(phone);
  if (!d) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(montarMensagem(nome, niche, undefined, dono, leadId))}`;
}

// Monta o link wa.me com a mensagem de abordagem do Lorenzo já preenchida,
// personalizando o benefício do site conforme o nicho do negócio.
// Limite de leads por disparo em massa (evita derrubar/bloquear o número).
export const WA_LIMIT = 10;

const norm = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Variações de mensagem: o gancho de valor muda por ramo.
const BENEFICIOS = [
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
const BENEFICIO_PADRAO = 'um site profissional poderia ajudar vocês a atrair mais clientes e automatizar o atendimento';

function beneficio(niche) {
  const n = norm(niche);
  return (BENEFICIOS.find((b) => b.kw.some((k) => n.includes(k))) || {}).txt || BENEFICIO_PADRAO;
}

const mensagem = (nome, niche) =>
  `Oi, ${nome}, tudo bem? Aqui é o Lorenzo!

Sou desenvolvedor web e ajudo negócios a se posicionarem melhor na internet. Estava dando uma olhada no perfil de vocês e tive uma ideia: ${beneficio(niche)}.

Faz sentido conversarmos rapidinho sobre isso? Posso te mandar um áudio curto explicando melhor a ideia? 😉`;

// Normaliza telefone BR para o formato do wa.me (DDI 55 + DDD + número, só dígitos).
export function normalizePhoneBR(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length < 10) return null; // sem DDD não dá pra montar
  // 12-13 dígitos começando com 55 = já tem DDI. Caso contrário, prefixa 55.
  // (10-11 dígitos começando com 55 são DDD 55/RS, então também prefixam.)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return '55' + d;
}

export function waLink(phone, nome, niche) {
  const d = normalizePhoneBR(phone);
  if (!d) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensagem(nome ?? '', niche))}`;
}

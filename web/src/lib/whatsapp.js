// Monta o link wa.me com a mensagem de abordagem do Lorenzo já preenchida.
// Limite de leads por disparo em massa (evita derrubar/bloquear o número).
export const WA_LIMIT = 10;

const mensagem = (nome) =>
  `Oi, ${nome}, tudo bem? Aqui é o Lorenzo!

Sou desenvolvedor web e ajudo negócios a se posicionarem melhor na internet. Estava dando uma olhada no perfil e tive algumas ideias de como um site profissional poderia ajudar vocês a atrair mais clientes e automatizar o atendimento.

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

export function waLink(phone, nome) {
  const d = normalizePhoneBR(phone);
  if (!d) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensagem(nome ?? ''))}`;
}

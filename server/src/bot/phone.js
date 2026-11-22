// Celular brasileiro no formato 55 + DDD + 9 dígitos, ou null.
export function mobileFromLead(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^00/, '').replace(/^55(?=\d{10,11}$)/, '').replace(/^0/, '');
  return /^[1-9][1-9]9\d{8}$/.test(digits) ? `55${digits}` : null;
}

// DDD + 8 últimos dígitos: o WhatsApp pode entregar o número sem o nono dígito.
export function phoneKey(digits) {
  const d = String(digits ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return d.slice(0, 2) + d.slice(-8);
}

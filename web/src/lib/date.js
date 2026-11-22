// Datas no fuso de quem usa: toISOString() é UTC e, no Brasil, já vira o dia às 21h.
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const hojeLocal = () => fmt(new Date());

export function addDias(base, dias) {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return fmt(d);
}

// Data no fuso do servidor (TZ no docker-compose): toISOString() é UTC e, no
// Brasil, já vira o dia às 21h, antecipando follow-ups.
export function hojeLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

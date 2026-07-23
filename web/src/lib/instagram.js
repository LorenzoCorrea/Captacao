// Extrai o @ (handle) do perfil a partir da URL do Instagram que o
// enriquecimento achou. Mostrar o @ visível permite abordar pela DM quando o
// lead não tem WhatsApp — segundo canal de contato do funil.
const NOT_PROFILE = new Set([
  'p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv',
  'directory', 'about', 'legal', 'developer', 'web',
]);

export function igHandle(url) {
  if (!url) return null;
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
    const h = seg.replace(/^@/, '').toLowerCase();
    // Handles válidos do Instagram: letras/números/ponto/underscore, até 30.
    if (!h || NOT_PROFILE.has(h) || !/^[a-z0-9._]{1,30}$/.test(h)) return null;
    return h;
  } catch {
    return null;
  }
}

export const igUrl = (handle) => `https://instagram.com/${handle}`;

// 1234 -> "1,2 mil" · 2500000 -> "2,5 M" · null -> null
export function fmtSeguidores(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(',0', '')} mil`;
  return String(n);
}

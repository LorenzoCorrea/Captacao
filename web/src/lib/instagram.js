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

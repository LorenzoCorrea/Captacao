// Configurações compartilhadas: o banco é a fonte e o localStorage é o cache que
// as telas leem na hora. Sem banco, cada navegador segue com o que tem salvo.
const STORAGE = {
  msgConfig: 'captacao.msgConfig',
  limits: 'captacao.limits',
  usage: 'captacao.usage',
  lastSearchId: 'captacao.lastSearchId',
};
const RAW_KEYS = new Set(['lastSearchId']); // guardado como texto puro

function writeLocal(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(STORAGE[key]);
    else localStorage.setItem(STORAGE[key], RAW_KEYS.has(key) ? value : JSON.stringify(value));
  } catch { /* localStorage indisponível: segue sem cache */ }
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(STORAGE[key]);
    if (raw === null) return null;
    return RAW_KEYS.has(key) ? raw : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function pushSetting(key, value) {
  fetch(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  }).catch(() => { /* fica no cache; o próximo sync reenvia o que faltar no banco */ });
}

export async function syncSettings() {
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) return;
    const { settings } = await r.json();
    if (!settings) return; // sem banco
    for (const key of Object.keys(STORAGE)) {
      if (key in settings) {
        writeLocal(key, settings[key]);
      } else if (key !== 'usage') {
        // Primeira vez neste banco: leva o que este navegador já tinha salvo.
        const local = readLocal(key);
        if (local !== null) pushSetting(key, local);
      }
    }
  } catch { /* servidor fora: usa o cache */ }
}

export function registerUsage(canal) {
  fetch('/api/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canal }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => { if (data?.usage) writeLocal('usage', data.usage); })
    .catch(() => { /* o contador local já foi somado */ });
}

export function rememberSearch(id) {
  writeLocal('lastSearchId', id);
  pushSetting('lastSearchId', id);
}

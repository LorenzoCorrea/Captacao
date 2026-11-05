// Com PUBLIC_PREVIEW_URL no servidor, o link da prévia abre fora da rede e pode ir ao cliente.
let base = '';
export const setPreviewBase = (url) => { base = (url || '').replace(/\/$/, ''); };
export const previewUrl = (searchId, leadId) => `${base}/previa/${searchId}/${encodeURIComponent(leadId)}`;

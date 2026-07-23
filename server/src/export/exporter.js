import ExcelJS from 'exceljs';

// Colunas únicas para CSV e XLSX (mantém os dois formatos consistentes).
const COLUMNS = [
  { header: 'Nome', key: 'name' },
  { header: 'Telefone', key: 'phone' },
  { header: 'Endereço', key: 'address' },
  { header: 'Avaliação', key: 'rating' },
  { header: 'Qtd. avaliações', key: 'reviewsCount' },
  { header: 'E-mail', key: 'email' },
  { header: 'Instagram @', key: 'instagramHandle' },
  { header: 'Seguidores IG', key: 'igFollowers' },
  { header: 'Instagram', key: 'instagram' },
  { header: 'Facebook', key: 'facebook' },
  { header: 'LinkedIn', key: 'linkedin' },
  { header: 'WhatsApp', key: 'whatsapp' },
  { header: 'Dono (sócio)', key: 'ownerName' },
  { header: 'CNPJ', key: 'cnpj' },
  { header: 'Anos de empresa', key: 'companyAge' },
  { header: 'Porte', key: 'porte' },
  { header: 'Estágio', key: 'stage' },
  { header: 'Status', key: 'status' },
  { header: 'Confiança', key: 'confidence' },
  { header: 'Origem', key: 'source' },
  { header: 'Latitude', key: 'lat' },
  { header: 'Longitude', key: 'lng' },
];

// Extrai o @ do perfil da URL do Instagram (espelha web/src/lib/instagram.js) —
// no export o @ facilita a abordagem por DM quando o lead não tem WhatsApp.
function igHandle(url) {
  if (!url) return '';
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
    const h = seg.replace(/^@/, '').toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(h) ? `@${h}` : '';
  } catch {
    return '';
  }
}

function rowsFromLeads(leads) {
  return leads.map((l) => {
    const e = l.enrichment ?? {};
    return {
      name: l.name ?? '',
      phone: l.phone ?? '',
      address: l.address ?? '',
      rating: l.rating ?? '',
      reviewsCount: l.reviewsCount ?? '',
      email: e.email ?? '',
      instagramHandle: igHandle(e.instagram),
      igFollowers: e.igFollowers ?? '',
      instagram: e.instagram ?? '',
      facebook: e.facebook ?? '',
      linkedin: e.linkedin ?? '',
      whatsapp: e.whatsapp ?? '',
      ownerName: e.ownerName ?? '',
      cnpj: e.cnpj ?? '',
      companyAge: e.companyAge ?? '',
      porte: e.porte ?? '',
      stage: l.stage ?? 'novo',
      status: l.enrichmentStatus ?? '',
      confidence: e.confidence ?? '',
      source: l.source ?? '',
      lat: l.lat ?? '',
      lng: l.lng ?? '',
    };
  });
}

// Letra de coluna do Excel (1 -> A, 27 -> AA): não quebra se passar de 26 colunas.
const colLetter = (n) => {
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const escapeCsv = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV padrão (vírgula, universal para CRMs). BOM p/ o Excel ler UTF-8 direito.
export function toCSV(leads) {
  const rows = rowsFromLeads(leads);
  const head = COLUMNS.map((c) => c.header).join(',');
  const body = rows.map((r) => COLUMNS.map((c) => escapeCsv(r[c.key])).join(',')).join('\r\n');
  return '﻿' + head + (body ? '\r\n' + body : '');
}

export async function toXLSX(leads) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(12, c.header.length + 3) }));
  ws.addRows(rowsFromLeads(leads));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F4' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }]; // congela o cabeçalho
  ws.autoFilter = { from: 'A1', to: `${colLetter(COLUMNS.length)}1` };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

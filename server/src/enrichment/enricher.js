import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import path from 'node:path';
import * as db from '../db.js';

// Gerencia as sessões SSE E executa o enriquecimento real chamando o worker
// Python (workers/enrich.py — DuckDuckGo, gratuito). Uma fila com concorrência
// limitada mantém o ritmo educado com o DDG (menos bloqueio) sem travar a UI.
//
// A memória aqui é só um cache de trabalho: com DATABASE_URL ativa, o banco é
// a fonte de verdade — qualquer rota re-hidrata a sessão do Postgres quando ela
// já saiu da memória (TTL/restart), então nada se perde.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../workers/enrich.py');
const PY = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py' : 'python3');

const MAX_CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 2);
const BACKGROUND = process.env.ENRICH_BACKGROUND !== 'false'; // pré-aquece todos por padrão
const USE_MOCK = process.env.ENRICH_PROVIDER === 'mock'; // demo offline sem rede
const TTL_MS = 30 * 60 * 1000; // tempo OCIOSO até liberar a memória (deslizante)
const RETRY_DELAY_MS = 20000; // espera antes de re-tentar um lead bloqueado pelo DDG
const MAX_ATTEMPTS = 2;

const searches = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const touch = (s) => (s.lastActivity = Date.now());

// Concorrência GLOBAL (não por sessão): duas buscas abertas ao mesmo tempo
// continuam respeitando o limite total de chamadas simultâneas ao DDG.
let globalRunning = 0;

export function createSearch(leads, meta = {}) {
  const { city, niche } = meta;
  const id = crypto.randomUUID();
  const session = {
    id,
    city: city ?? '',
    niche: niche ?? '',
    query: { niche: niche ?? '', city: city ?? '', lat: meta.lat, lng: meta.lng, radiusKm: meta.radiusKm },
    found: meta.found ?? null,
    leads: new Map(leads.map((l) => [l.id, { ...l, enrichment: null, enrichmentStatus: 'pending', stage: 'novo', notes: '', followUpAt: null, tags: [], estimatedValue: null, interactions: [] }])),
    clients: new Set(),
    queue: [],
    inFlight: new Set(),
    running: 0,
    lastActivity: Date.now(),
  };
  searches.set(id, session);

  // Persiste a busca + leads em background (não bloqueia a resposta). dbReady
  // garante que os UPDATEs de enriquecimento/estágio só rodem após o INSERT.
  session.dbReady = db.saveSearch(session, meta).catch((e) => console.error('[db]', e.message));

  if (BACKGROUND) {
    session.queue = [...session.leads.keys()];
    pump(session);
  }
  return id;
}

// TTL deslizante: uma varredura periódica libera só as sessões realmente
// ociosas — sem clientes SSE, sem enriquecimento em curso e sem fila.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of searches) {
    const idle = now - (s.lastActivity ?? 0) > TTL_MS;
    if (idle && s.clients.size === 0 && s.running === 0 && s.queue.length === 0) destroySearch(id);
  }
}, 60 * 1000).unref();

// Snapshot dos leads (com enriquecimento atual) p/ exportação/webhook.
export async function getSearchLeads(searchId) {
  const s = searches.get(searchId);
  if (s) {
    touch(s);
    return { city: s.city, niche: s.niche, leads: [...s.leads.values()] };
  }
  return db.loadSearch(searchId); // sessão expirou/servidor reiniciou: tenta o banco
}

// Estágio do funil (Kanban). Fonte da verdade na sessão -> sai no export.
export const STAGES = ['novo', 'qualificado', 'contatado', 'ganho', 'descartado'];

// Atualiza campos editáveis do lead (CRM): stage, notes, followUpAt, tags,
// estimatedValue. Aceita um patch parcial; só os campos presentes são alterados.
// Se a sessão já saiu da memória, re-hidrata do banco antes — mover um card no
// Kanban NUNCA falha silenciosamente por causa do TTL.
export async function updateLead(searchId, leadId, patch = {}) {
  let s = searches.get(searchId);
  if (!s?.leads.get(leadId)) {
    await reopenSearch(searchId); // re-hidrata (no-op se não existe no banco)
    s = searches.get(searchId);
  }
  const lead = s?.leads.get(leadId);
  if (!lead) return false;
  touch(s);
  const fields = {};
  if (patch.stage !== undefined) {
    if (!STAGES.includes(patch.stage)) return false;
    lead.stage = patch.stage; fields.stage = patch.stage;
  }
  if (patch.notes !== undefined) { lead.notes = String(patch.notes); fields.notes = lead.notes; }
  if (patch.followUpAt !== undefined) { lead.followUpAt = patch.followUpAt || null; fields.followUpAt = lead.followUpAt; }
  if (patch.tags !== undefined) { lead.tags = Array.isArray(patch.tags) ? patch.tags : []; fields.tags = lead.tags; }
  if (patch.estimatedValue !== undefined) {
    const v = patch.estimatedValue === null || patch.estimatedValue === '' ? null : Number(patch.estimatedValue);
    lead.estimatedValue = Number.isFinite(v) ? v : null; fields.estimatedValue = lead.estimatedValue;
  }
  if (patch.msgVariant !== undefined) {
    if (patch.msgVariant !== null && !['A', 'B'].includes(patch.msgVariant)) return false;
    lead.msgVariant = patch.msgVariant; fields.msgVariant = patch.msgVariant;
  }
  if (patch.interactions !== undefined) {
    // Timeline: [{at, type, note?}]. Cap de 200 entradas; stringify porque o
    // node-pg converte array JS em array Postgres (não jsonb) se passar cru.
    lead.interactions = Array.isArray(patch.interactions)
      ? patch.interactions.filter((i) => i && typeof i.type === 'string').slice(-200)
      : [];
    fields.interactions = JSON.stringify(lead.interactions);
  }
  if (Object.keys(fields).length && db.dbEnabled && s.dbReady) {
    s.dbReady.then(() => db.saveLeadFields(searchId, leadId, fields)).catch(() => {});
  }
  return true;
}

// Reabre uma busca: se já saiu da memória (TTL/restart), re-hidrata do banco.
// Leads que ficaram 'pending' voltam pra fila — nada de spinner eterno.
export async function reopenSearch(searchId) {
  let s = searches.get(searchId);
  if (!s) {
    const data = await db.loadSearch(searchId);
    if (!data) return null;
    s = {
      id: searchId, city: data.city ?? '', niche: data.niche ?? '',
      query: data.query, found: data.found ?? null,
      leads: new Map(data.leads.map((l) => [l.id, l])),
      clients: new Set(), queue: [], inFlight: new Set(), running: 0,
      lastActivity: Date.now(),
      dbReady: Promise.resolve(),
    };
    searches.set(searchId, s);
    if (BACKGROUND) {
      s.queue = [...s.leads.values()].filter((l) => l.enrichmentStatus === 'pending').map((l) => l.id);
      pump(s);
    }
  }
  touch(s);
  return {
    searchId,
    query: s.query ?? { niche: s.niche, city: s.city },
    stats: { found: s.found, withoutWebsite: s.leads.size },
    leads: [...s.leads.values()],
  };
}

// Usuário interagiu com o lead -> fura a fila (não recomeça se já está pronto).
// Re-hidrata do banco se a sessão expirou.
export async function prioritizeLead(searchId, leadId) {
  let s = searches.get(searchId);
  if (!s) {
    await reopenSearch(searchId);
    s = searches.get(searchId);
  }
  const lead = s?.leads.get(leadId);
  if (!lead) return false;
  touch(s);
  if (lead.enrichmentStatus !== 'pending' || s.inFlight.has(leadId)) return true; // já tratado/em curso

  s.queue = s.queue.filter((id) => id !== leadId);
  s.queue.unshift(leadId); // topo da fila
  pump(s);
  return true;
}

export async function attachStream(searchId, req, res) {
  let s = searches.get(searchId);
  if (!s) {
    await reopenSearch(searchId); // sobrevive a TTL/restart sem F5 do usuário
    s = searches.get(searchId);
  }
  if (!s) return res.status(404).json({ error: 'Busca não encontrada (sessão expirada?)' });
  touch(s);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');

  // Replay: quem (re)conecta recebe na hora tudo que já foi enriquecido.
  for (const lead of s.leads.values()) {
    if (lead.enrichmentStatus !== 'pending') res.write(frame('enrichment', payloadOf(lead)));
  }
  if (allSettled(s)) res.write(frame('done', { searchId: s.id }));

  s.clients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    s.clients.delete(res);
    touch(s); // o TTL ocioso começa a contar quando o último cliente sai
  });
}

// ── Fila com concorrência limitada (limite GLOBAL entre sessões) ────────────
function pump(session) {
  while (globalRunning < MAX_CONCURRENCY && session.queue.length) {
    const leadId = session.queue.shift();
    const lead = session.leads.get(leadId);
    if (!lead || lead.enrichmentStatus !== 'pending' || session.inFlight.has(leadId)) continue;
    globalRunning++;
    session.running++;
    session.inFlight.add(leadId);
    runOne(session, lead).finally(() => {
      globalRunning--;
      session.running--;
      session.inFlight.delete(leadId);
      pumpAll(); // um slot livre pode servir QUALQUER sessão com fila
    });
  }
}

function pumpAll() {
  for (const s of searches.values()) {
    if (globalRunning >= MAX_CONCURRENCY) break;
    if (s.queue.length) pump(s);
  }
}

async function runOne(session, lead) {
  await sleep(200 + Math.random() * 800); // jitter: educado com o DuckDuckGo
  const enrichment = USE_MOCK ? mockEnrichment(lead) : await spawnPython(lead, session.city);

  const achou = enrichment && (enrichment.email || enrichment.instagram || enrichment.facebook || enrichment.linkedin);
  // Falha transitória (worker caiu, DDG bloqueou/timeout) SEM nenhum contato:
  // re-tenta com backoff em vez de gravar "not_found" — bloqueio de rate-limit
  // não pode virar veredito definitivo no banco.
  const transient = !achou && (!enrichment || enrichment.partial);
  lead.attempts = (lead.attempts ?? 0) + 1;
  if (transient && lead.attempts < MAX_ATTEMPTS) {
    setTimeout(() => {
      if (!searches.has(session.id) || lead.enrichmentStatus !== 'pending') return;
      session.queue.push(lead.id);
      pump(session);
    }, RETRY_DELAY_MS).unref();
    return; // continua 'pending' — o retry decide o status final
  }

  lead.enrichment = enrichment;
  lead.enrichmentStatus = achou ? 'done' : 'not_found';

  broadcast(session, 'enrichment', payloadOf(lead));
  if (db.dbEnabled) session.dbReady.then(() => db.saveEnrichment(session.id, lead)).catch(() => {});
  if (allSettled(session)) broadcast(session, 'done', { searchId: session.id });
}

function spawnPython(lead, city) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ name: lead.name, city, phone: lead.phone, place_id: lead.id });
    const child = spawn(PY, [SCRIPT, payload], {
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const kill = setTimeout(() => child.kill(), 20000); // rede travada não trava a fila
    child.stdout.on('data', (d) => (out += d));
    // stderr precisa ser consumido: pipe cheio (64KB) travaria o processo filho.
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    child.on('error', (e) => {
      clearTimeout(kill);
      console.error(`[enrich] falha ao iniciar o worker Python (${PY}):`, e.message);
      resolve(null); // py ausente etc. → tratado como falha transitória
    });
    child.on('close', (code) => {
      clearTimeout(kill);
      try {
        resolve(JSON.parse(out.trim().split(/\r?\n/).pop()));
      } catch {
        if (code !== 0 || err) console.error(`[enrich] worker saiu com código ${code}:`, err.trim().slice(0, 500));
        resolve(null);
      }
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const payloadOf = (lead) => ({ leadId: lead.id, status: lead.enrichmentStatus, enrichment: lead.enrichment });
const allSettled = (s) => [...s.leads.values()].every((l) => l.enrichmentStatus !== 'pending');

function broadcast(session, event, data) {
  const f = frame(event, data);
  for (const res of session.clients) res.write(f);
}

function destroySearch(id) {
  const s = searches.get(id);
  if (!s) return;
  for (const res of s.clients) res.end();
  searches.delete(id);
}

// Fallback offline (ENRICH_PROVIDER=mock): contatos fictícios, sem rede.
// "Não achou" aqui é veredito final (partial:false) — null significaria falha
// transitória e cairia no retry, atrasando a demo à toa.
function mockEnrichment(lead) {
  if (Math.random() < 0.15) {
    return { email: null, instagram: null, facebook: null, linkedin: null, whatsapp: lead.phone, confidence: 0, partial: false };
  }
  const slug = lead.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '');
  const socios = ['Maria Oliveira', 'João Pereira', 'Ana Souza', 'Carlos Lima'];
  const temCnpj = Math.random() < 0.5;
  const instagram = Math.random() < 0.8 ? `https://instagram.com/${slug}` : null;
  return {
    email: Math.random() < 0.6 ? `contato@${slug}.com.br` : null,
    instagram,
    igFollowers: instagram && Math.random() < 0.7 ? Math.floor(80 + Math.random() * 20000) : null,
    facebook: Math.random() < 0.4 ? `https://facebook.com/${slug}` : null,
    linkedin: null,
    whatsapp: lead.phone,
    confidence: 0.7,
    partial: false,
    cnpj: temCnpj ? '12345678000190' : null,
    razaoSocial: temCnpj ? `${lead.name} LTDA` : null,
    ownerName: temCnpj ? socios[Math.floor(Math.random() * socios.length)] : null,
    companyAge: temCnpj ? 2 + Math.floor(Math.random() * 12) : null,
    porte: temCnpj ? 'MICRO EMPRESA' : null,
    cnpjActive: temCnpj ? true : null,
  };
}

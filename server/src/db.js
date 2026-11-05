// Persistência opcional em PostgreSQL. Se DATABASE_URL não estiver definida (ou
// o banco estiver fora do ar), TODAS as funções viram no-op e o app segue 100%
// em memória, exatamente como antes — persistência é aditiva, nunca bloqueante.
//
// O banco mora no home server (ZimaOS) e é acessado via Tailscale. A connection
// string fica em server/.env (DATABASE_URL=postgresql://user:senha@100.x:5432/db).
import pg from 'pg';
import { hojeLocal } from './date.js';

const { Pool } = pg;
const url = process.env.DATABASE_URL;
// Configuração não significa conexão pronta. Só anuncia persistência após
// preparar o schema; se o boot falhar, todas as operações usam o fallback.
export let dbEnabled = false;

const pool = url
  ? new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000 })
  : null;
// Erro assíncrono de um cliente ocioso não pode derrubar o processo.
if (pool) pool.on('error', (e) => console.error('[db] erro no pool:', e.message));

// Fila de gravações: se o banco estiver fora, nada se perde enquanto a API viver.
// shortcut: a fila fica em memória e some se a API reiniciar; persistir em disco se isso virar problema.
const outbox = [];
const FLUSH_MS = 15000;
const CONNECTION_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', '57P01', '57P02', '57P03', '53300', '08000', '08003', '08006']);
const isConnectionError = (e) => CONNECTION_ERRORS.has(e?.code) || /timeout|terminated|not queryable|Connection/i.test(e?.message ?? '');
let lastDbError = null;

async function persist(label, write) {
  if (!pool) return;
  if (!dbEnabled || outbox.length) {
    outbox.push({ label, write }); // mantém a ordem: o INSERT da busca vem antes dos UPDATEs
    return;
  }
  try {
    await write();
    lastDbError = null;
  } catch (e) {
    if (isConnectionError(e)) {
      lastDbError = e.message;
      outbox.push({ label, write });
    }
    console.error(`[db] ${label}:`, e.message);
  }
}

export async function flushOutbox() {
  while (dbEnabled && outbox.length) {
    const { label, write } = outbox[0];
    try {
      await write();
      lastDbError = null;
    } catch (e) {
      console.error(`[db] ${label}:`, e.message);
      if (isConnectionError(e)) {
        lastDbError = e.message;
        return; // ainda fora do ar: tenta de novo no próximo ciclo
      }
    }
    outbox.shift();
  }
}
setInterval(() => flushOutbox().catch(() => {}), FLUSH_MS).unref();

// Estado que a tela usa para avisar quando há alterações ainda não salvas.
export const dbStatus = () => ({
  configured: Boolean(pool),
  dbEnabled,
  pendingWrites: outbox.length,
  offline: Boolean(pool) && (!dbEnabled || Boolean(lastDbError)),
});

const DDL = `
CREATE TABLE IF NOT EXISTS searches (
  id         uuid PRIMARY KEY,
  niche      text NOT NULL,
  city       text,
  lat        double precision,
  lng        double precision,
  radius_km  double precision,
  found      integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leads (
  search_id         uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  lead_id           text NOT NULL,
  name              text,
  address           text,
  phone             text,
  lat               double precision,
  lng               double precision,
  has_website       boolean,
  source            text,
  niche             text,
  rating            double precision,
  reviews_count     integer,
  enrichment        jsonb,
  enrichment_status text NOT NULL DEFAULT 'pending',
  stage             text NOT NULL DEFAULT 'novo',
  notes             text,
  follow_up_at      text,
  tags              text[] DEFAULT '{}',
  estimated_value   numeric,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (search_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_search_stage ON leads(search_id, stage);
-- Migração idempotente: adiciona as colunas de CRM em bancos criados antes.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_at text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_value numeric;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS interactions jsonb DEFAULT '[]';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS msg_variant text;
-- Configurações compartilhadas entre aparelhos (mensagens, limites, contadores).
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Bot do WhatsApp. Sem chave estrangeira para leads: histórico e saídas sobrevivem a limpezas.
CREATE TABLE IF NOT EXISTS bot_conversations (
  lead_id       text PRIMARY KEY,
  phone         text NOT NULL,
  phone_key     text NOT NULL UNIQUE,
  name          text,
  niche         text,
  search_id     uuid,
  status        text NOT NULL DEFAULT 'queued',
  reason        text,
  ai_turns      integer NOT NULL DEFAULT 0,
  discount_asks integer NOT NULL DEFAULT 0,
  ai_first_fail timestamptz,
  ai_next_retry timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bot_conversations ADD COLUMN IF NOT EXISTS lid text;
CREATE INDEX IF NOT EXISTS idx_bot_conversations_lid ON bot_conversations(lid);
ALTER TABLE bot_conversations ADD COLUMN IF NOT EXISTS followup_at timestamptz;
CREATE TABLE IF NOT EXISTS bot_messages (
  id         text PRIMARY KEY,
  lead_id    text NOT NULL,
  direction  text NOT NULL,
  source     text NOT NULL,
  body       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_messages_lead ON bot_messages(lead_id, created_at);
CREATE TABLE IF NOT EXISTS bot_optouts (
  phone_key  text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

// O container do Postgres pode ter sido criado com outro POSTGRES_DB (ex.:
// "estudos_js"). Se o banco da DATABASE_URL não existir (erro 3D000), conecta
// no banco administrativo "postgres" com as mesmas credenciais e cria — zero
// passo manual no Portainer.
async function createDatabaseIfMissing() {
  const u = new URL(url);
  const dbName = decodeURIComponent(u.pathname.slice(1));
  if (!dbName) throw new Error('DATABASE_URL sem nome de banco');
  u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 8000 });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
    console.log(`[db] banco "${dbName}" criado automaticamente.`);
  } finally {
    await admin.end().catch(() => {});
  }
}

export async function initDb() {
  dbEnabled = false;
  if (!pool) {
    console.log('[db] DATABASE_URL ausente — rodando em memória (sem persistência).');
    return false;
  }
  try {
    await pool.query(DDL);
    dbEnabled = true;
    console.log('[db] schema pronto — persistência ATIVADA.');
    return true;
  } catch (e) {
    if (e.code === '3D000') {
      // banco não existe ainda — cria e tenta de novo
      try {
        await createDatabaseIfMissing();
        await pool.query(DDL);
        dbEnabled = true;
        console.log('[db] schema pronto — persistência ATIVADA.');
        return true;
      } catch (e2) {
        console.error('[db] falha ao criar o banco (seguindo em memória):', e2.message);
        return false;
      }
    }
    console.error('[db] falha ao preparar o schema (seguindo em memória):', e.message);
    return false;
  }
}

// Grava a busca e todos os leads de uma vez (transação). Devolve a Promise para
// que updates posteriores (enriquecimento/estágio) esperem o INSERT terminar.
export async function saveSearch(search, meta = {}) {
  return persist('saveSearch', () => writeSearch(search, meta));
}

async function writeSearch(search, meta) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO searches (id, niche, city, lat, lng, radius_km, found)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [search.id, meta.niche ?? '', meta.city ?? null, meta.lat ?? null, meta.lng ?? null, meta.radiusKm ?? null, meta.found ?? null]
    );
    // INSERT em lote (multi-VALUES): com o Postgres do outro lado da Tailscale,
    // 150 inserts sequenciais custariam segundos; em lote é 1 round-trip.
    const leads = [...search.leads.values()];
    const CHUNK = 200; // 21 params/linha → bem abaixo do limite de 65535 do protocolo
    for (let off = 0; off < leads.length; off += CHUNK) {
      const chunk = leads.slice(off, off + CHUNK);
      const vals = [];
      const rows = chunk.map((l, i) => {
        const row = [search.id, l.id, l.name, l.address, l.phone, l.lat, l.lng, l.hasWebsite ?? false, l.source ?? null, l.niche ?? null, l.rating ?? null, l.reviewsCount ?? null, l.enrichment ?? null, l.enrichmentStatus, l.stage,
          l.notes ?? null, l.followUpAt ?? null, l.tags ?? [], l.estimatedValue ?? null, JSON.stringify(l.interactions ?? []), l.msgVariant ?? null];
        vals.push(...row);
        return `(${row.map((_, n) => `$${i * row.length + n + 1}`).join(',')})`;
      });
      if (!rows.length) continue;
      await client.query(
        `INSERT INTO leads (search_id, lead_id, name, address, phone, lat, lng, has_website, source, niche, rating, reviews_count, enrichment, enrichment_status, stage, notes, follow_up_at, tags, estimated_value, interactions, msg_variant)
         VALUES ${rows.join(',')}
         ON CONFLICT (search_id, lead_id) DO NOTHING`,
        vals
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function saveEnrichment(searchId, lead) {
  return persist('saveEnrichment', () => pool.query(
    `UPDATE leads SET enrichment=$2, enrichment_status=$3, updated_at=now() WHERE lead_id=$1`,
    [lead.id, lead.enrichment ?? null, lead.enrichmentStatus]
  ));
}

export async function saveStage(searchId, leadId, stage) {
  return persist('saveStage', () => pool.query(
    `UPDATE leads SET stage=$2, updated_at=now() WHERE lead_id=$1`, [leadId, stage]
  ));
}

// Atualiza os campos editáveis do lead (CRM): stage, notas, follow-up, tags, valor.
export async function saveLeadFields(searchId, leadId, fields = {}) {
  const map = { stage: 'stage', notes: 'notes', followUpAt: 'follow_up_at', tags: 'tags', estimatedValue: 'estimated_value', interactions: 'interactions', msgVariant: 'msg_variant' };
  const sets = []; const vals = []; let i = 1;
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) { sets.push(`${col}=$${i++}`); vals.push(fields[k]); }
  }
  if (!sets.length) return;
  vals.push(leadId);
  // Por empresa, não por busca: a mesma empresa em duas buscas é um lead só.
  return persist('saveLeadFields', () => pool.query(
    `UPDATE leads SET ${sets.join(', ')}, updated_at=now() WHERE lead_id=$${i}`, vals
  ));
}

// Estado já conhecido de empresas que apareceram em buscas anteriores.
export async function loadKnownLeads(ids) {
  if (!dbEnabled || !ids.length) return new Map();
  try {
    const r = await pool.query(
      'SELECT DISTINCT ON (lead_id) * FROM leads WHERE lead_id = ANY($1) ORDER BY lead_id, updated_at DESC', [ids]
    );
    return new Map(r.rows.map((row) => [row.lead_id, rowToLead(row)]));
  } catch (e) {
    console.error('[db] loadKnownLeads:', e.message);
    return new Map();
  }
}

export async function loadSettings() {
  if (!dbEnabled) return null;
  try {
    const r = await pool.query('SELECT key, value FROM app_settings');
    return Object.fromEntries(r.rows.map((row) => [row.key, row.value]));
  } catch (e) {
    console.error('[db] loadSettings:', e.message);
    return null;
  }
}

export async function saveSetting(key, value) {
  return persist('saveSetting', () => pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  ));
}

// Conta o envio de forma atômica: dois aparelhos não podem furar o limite anti-ban.
// Lança erro em falha: sem contar, o bot não envia.
export async function incrementUsage(canal, date, at) {
  if (!dbEnabled) return null;
  const r = await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ('usage', jsonb_build_object('date', $1::text, $2::text, 1, 'lastAt', $3::bigint))
     ON CONFLICT (key) DO UPDATE SET updated_at = now(), value =
       CASE WHEN app_settings.value->>'date' = $1::text
         THEN jsonb_set(jsonb_set(app_settings.value, ARRAY[$2::text],
                to_jsonb(COALESCE((app_settings.value->>$2::text)::int, 0) + 1)),
                '{lastAt}', to_jsonb($3::bigint))
         ELSE EXCLUDED.value END
     RETURNING value`,
    [date, canal, at]
  );
  return r.rows[0].value;
}

// Busca na base local de estabelecimentos. Devolve null quando ela não existe ou
// falha, e aí quem chama recorre ao Overpass. O formato é o mesmo dele.
export async function buscarOsmLocal({ tags, nameRegex, lat, lng, radiusKm, limit = 500 }) {
  if (!dbEnabled) return null;
  const KM_POR_GRAU = 111.32;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLat = radiusKm / KM_POR_GRAU;
  const dLng = dLat / cosLat;
  try {
    const r = await pool.query(
      `SELECT id, lat, lng, props FROM osm_places
       WHERE lat BETWEEN $1::float8 AND $2::float8 AND lng BETWEEN $3::float8 AND $4::float8
         AND (tags && $5::text[] OR ($6::text <> '' AND name_norm ~ $6::text))
       ORDER BY power((lat - $7::float8) * ${KM_POR_GRAU}, 2) + power((lng - $8::float8) * ${KM_POR_GRAU} * $9::float8, 2)
       LIMIT $10`,
      [lat - dLat, lat + dLat, lng - dLng, lng + dLng, tags, nameRegex, lat, lng, cosLat, limit]
    );
    return r.rows
      .filter((p) => Math.hypot((p.lat - lat) * KM_POR_GRAU, (p.lng - lng) * KM_POR_GRAU * cosLat) <= radiusKm)
      .map((p) => {
        const [type, id] = p.id.split('/');
        return { type, id, lat: p.lat, lon: p.lng, tags: p.props };
      });
  } catch (e) {
    if (e.code !== '42P01') console.error('[db] buscarOsmLocal:', e.message); // 42P01: base ainda não carregada
    return null;
  }
}

function rowToLead(r) {
  return {
    id: r.lead_id, name: r.name, address: r.address, phone: r.phone,
    lat: r.lat, lng: r.lng, hasWebsite: r.has_website, source: r.source, niche: r.niche,
    rating: r.rating, reviewsCount: r.reviews_count,
    enrichment: r.enrichment, enrichmentStatus: r.enrichment_status, stage: r.stage,
    notes: r.notes ?? '', followUpAt: r.follow_up_at ?? null,
    tags: r.tags ?? [], estimatedValue: r.estimated_value != null ? Number(r.estimated_value) : null,
    interactions: r.interactions ?? [],
    msgVariant: r.msg_variant ?? null,
  };
}

// Fallback para export/webhook quando a sessão já saiu da memória (TTL/restart).
export async function loadSearch(searchId) {
  if (!dbEnabled) return null;
  try {
    const s = await pool.query('SELECT * FROM searches WHERE id=$1', [searchId]);
    if (!s.rowCount) return null;
    const r = s.rows[0];
    const leads = await pool.query('SELECT * FROM leads WHERE search_id=$1 ORDER BY created_at', [searchId]);
    return {
      city: r.city, niche: r.niche, found: r.found,
      query: { niche: r.niche, city: r.city, lat: r.lat, lng: r.lng, radiusKm: r.radius_km },
      leads: leads.rows.map(rowToLead),
    };
  } catch (e) { console.error('[db] loadSearch:', e.message); return null; }
}

// Estatísticas de conversão (geral + por nicho + por cidade) para o dashboard.
export async function statsConversao() {
  if (!dbEnabled) return null;
  const agg = `count(DISTINCT l.lead_id)::int total,
               count(DISTINCT l.lead_id) FILTER (WHERE l.stage='ganho')::int ganho,
               count(DISTINCT l.lead_id) FILTER (WHERE l.stage='contatado')::int contatado,
               count(DISTINCT l.lead_id) FILTER (WHERE l.stage='qualificado')::int qualificado`;
  try {
    const geral = await pool.query(
      `SELECT count(l.*)::int total,
              count(*) FILTER (WHERE l.stage='ganho')::int ganho,
              count(*) FILTER (WHERE l.stage='contatado')::int contatado,
              count(*) FILTER (WHERE l.stage='qualificado')::int qualificado,
              count(*) FILTER (WHERE l.stage='descartado')::int descartado,
              (SELECT count(*)::int FROM searches) buscas,
              COALESCE(sum(l.estimated_value) FILTER (WHERE l.stage NOT IN ('descartado','ganho')), 0)::float pipeline_value,
              COALESCE(sum(l.estimated_value) FILTER (WHERE l.stage='ganho'), 0)::float won_value
       FROM (SELECT DISTINCT ON (lead_id) * FROM leads ORDER BY lead_id, updated_at DESC) l`
    );
    const porNicho = await pool.query(
      `SELECT s.niche AS chave, ${agg}
       FROM leads l JOIN searches s ON s.id = l.search_id
       GROUP BY s.niche ORDER BY ganho DESC, total DESC LIMIT 20`
    );
    const porCidade = await pool.query(
      `SELECT s.city AS chave, ${agg}
       FROM leads l JOIN searches s ON s.id = l.search_id
       GROUP BY s.city ORDER BY ganho DESC, total DESC LIMIT 20`
    );
    // A/B: conversão por variante de mensagem (só leads que foram abordados)
    const porVariante = await pool.query(
      `SELECT ('Mensagem ' || l.msg_variant) AS chave, ${agg}
       FROM leads l WHERE l.msg_variant IS NOT NULL
       GROUP BY l.msg_variant ORDER BY l.msg_variant`
    );
    return { geral: geral.rows[0], porNicho: porNicho.rows, porCidade: porCidade.rows, porVariante: porVariante.rows };
  } catch (e) { console.error('[db] statsConversao:', e.message); return null; }
}

// Painel "Hoje": o que precisa de ação AGORA, cruzando TODAS as buscas —
// follow-ups vencidos + contatados sem resposta há 3+ dias e sem retorno
// agendado. A venda está no 4º toque; isso aqui é o que impede o lead esfriar.
export async function todayLeads() {
  if (!dbEnabled) return null;
  const today = hojeLocal(); // follow_up_at é text YYYY-MM-DD
  try {
    const r = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (l.lead_id) l.*, s.city AS search_city, s.niche AS search_niche
         FROM leads l JOIN searches s ON s.id = l.search_id
         WHERE (l.follow_up_at IS NOT NULL AND l.follow_up_at <= $1 AND l.stage NOT IN ('ganho','descartado'))
            OR (l.stage = 'contatado' AND l.follow_up_at IS NULL AND l.updated_at < now() - interval '3 days')
         ORDER BY l.lead_id, l.updated_at DESC
       ) l
       ORDER BY l.follow_up_at NULLS LAST, l.updated_at ASC
       LIMIT 100`,
      [today]
    );
    return r.rows.map((row) => ({
      ...rowToLead(row),
      searchId: row.search_id,
      searchCity: row.search_city,
      searchNiche: row.search_niche,
    }));
  } catch (e) { console.error('[db] todayLeads:', e.message); return null; }
}

// Histórico de buscas (com contagem de leads e enriquecidos).
export async function listSearches(limit = 50) {
  if (!dbEnabled) return [];
  try {
    const r = await pool.query(
      `SELECT s.id, s.niche, s.city, s.found, s.created_at,
              count(l.*)::int AS leads,
              count(*) FILTER (WHERE l.enrichment_status <> 'pending')::int AS enriched
       FROM searches s LEFT JOIN leads l ON l.search_id = s.id
       GROUP BY s.id ORDER BY s.created_at DESC LIMIT $1`, [limit]
    );
    return r.rows;
  } catch (e) { console.error('[db] listSearches:', e.message); return []; }
}

// ── Bot do WhatsApp ─────────────────────────────────────────────────────────
// Lançam erro em falha de banco: o bot não deve agir sem saber o estado da conversa.
const botRows = async (text, values) => (await pool.query(text, values)).rows;

export async function botEnqueue({ leadId, phone, phoneKey, name, niche, searchId = null }) {
  const r = await pool.query(
    `INSERT INTO bot_conversations (lead_id, phone, phone_key, name, niche, search_id)
     SELECT $1, $2, $3, $4, $5, $6::uuid
     WHERE NOT EXISTS (SELECT 1 FROM bot_optouts WHERE phone_key = $3)
     ON CONFLICT DO NOTHING`,
    [leadId, phone, phoneKey, name, niche, searchId]
  );
  return r.rowCount === 1;
}

export const botNextQueued = async () =>
  (await botRows(`SELECT * FROM bot_conversations WHERE status = 'queued' ORDER BY created_at, lead_id LIMIT 1`))[0] ?? null;

export const botGet = async (leadId) =>
  (await botRows('SELECT * FROM bot_conversations WHERE lead_id = $1', [leadId]))[0] ?? null;

export const botGetByPhoneKey = async (key) =>
  (await botRows('SELECT * FROM bot_conversations WHERE phone_key = $1', [key]))[0] ?? null;

export const botGetByLid = async (lid) =>
  (await botRows('SELECT * FROM bot_conversations WHERE lid = $1', [lid]))[0] ?? null;

export async function botSetLid(leadId, lid) {
  await pool.query('UPDATE bot_conversations SET lid = $2 WHERE lead_id = $1', [leadId, lid]);
}

export const botList = () => botRows(
  `SELECT c.*, (SELECT body FROM bot_messages m WHERE m.lead_id = c.lead_id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_body
   FROM bot_conversations c ORDER BY c.updated_at DESC LIMIT 200`
);

// Muda o estado só a partir dos estados esperados: pausa, saída e encerramento nunca são sobrescritos.
export async function botTransition(leadId, from, to, reason = null) {
  const r = await pool.query(
    'UPDATE bot_conversations SET status = $3, reason = $4, updated_at = now() WHERE lead_id = $1 AND status = ANY($2)',
    [leadId, from, to, reason]
  );
  return r.rowCount === 1;
}

export const botClaim = (conv) => botTransition(conv.lead_id, ['queued'], 'sending');

// Envio interrompido por um reinício: pode ter saído, então só Lorenzo decide.
export const botRecoverSending = () => botRows(
  `UPDATE bot_conversations SET status = 'paused', reason = 'send_interrupted', updated_at = now() WHERE status = 'sending' RETURNING *`
);

export async function botAddMessage({ id, leadId, direction, source, body }) {
  const r = await pool.query(
    `INSERT INTO bot_messages (id, lead_id, direction, source, body) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [id, leadId, direction, source, body]
  );
  if (r.rowCount === 1) await pool.query('UPDATE bot_conversations SET updated_at = now() WHERE lead_id = $1', [leadId]);
  return r.rowCount === 1;
}

export const botHistory = (leadId) =>
  botRows('SELECT id, direction, source, body, created_at FROM bot_messages WHERE lead_id = $1 ORDER BY created_at, id', [leadId]);

export const botMessageSource = async (id) =>
  (await botRows('SELECT source FROM bot_messages WHERE id = $1', [id]))[0]?.source ?? null;

// Conversas ativas cuja última mensagem é do lead e já passou da espera (junta mensagens seguidas).
export const botDueReplies = (olderThanSec) => botRows(
  `SELECT c.* FROM bot_conversations c
   JOIN LATERAL (SELECT direction, source, created_at FROM bot_messages m WHERE m.lead_id = c.lead_id ORDER BY created_at DESC, id DESC LIMIT 1) last ON true
   WHERE c.status = 'active' AND last.direction = 'in' AND last.source = 'lead'
     AND last.created_at <= now() - make_interval(secs => $1)
     AND (c.ai_next_retry IS NULL OR c.ai_next_retry <= now())`,
  [olderThanSec]
);

export async function botSetAiFailure(leadId, firstFailAt, nextRetry) {
  await pool.query('UPDATE bot_conversations SET ai_first_fail = $2, ai_next_retry = $3 WHERE lead_id = $1', [leadId, firstFailAt, nextRetry]);
}

export async function botClearAiFailure(leadId) {
  await pool.query('UPDATE bot_conversations SET ai_first_fail = NULL, ai_next_retry = NULL WHERE lead_id = $1', [leadId]);
}

export const botIncrementTurn = async (leadId) =>
  (await botRows('UPDATE bot_conversations SET ai_turns = ai_turns + 1 WHERE lead_id = $1 RETURNING ai_turns', [leadId]))[0].ai_turns;

export const botIncrementDiscount = async (leadId) =>
  (await botRows('UPDATE bot_conversations SET discount_asks = discount_asks + 1 WHERE lead_id = $1 RETURNING discount_asks', [leadId]))[0].discount_asks;

// Para o resumo periódico: primeiro envio e primeira resposta de cada lead desde `since`, e quem ainda não respondeu.
export async function botDigest(since) {
  const rows = await botRows(
    `WITH f AS (
       SELECT c.name, c.niche, c.status,
         (SELECT min(created_at) FROM bot_messages m WHERE m.lead_id = c.lead_id AND m.source = 'bot') AS first_out,
         (SELECT min(created_at) FROM bot_messages m WHERE m.lead_id = c.lead_id AND m.source = 'lead') AS first_in
       FROM bot_conversations c)
     SELECT name, niche, first_out >= $1 AS contacted, first_in >= $1 AS replied,
       (status = 'active' AND first_out IS NOT NULL AND first_in IS NULL) AS waiting
     FROM f WHERE first_out >= $1 OR first_in >= $1 OR (status = 'active' AND first_out IS NOT NULL AND first_in IS NULL)
     ORDER BY first_out`,
    [since]
  );
  const pick = (key) => rows.filter((r) => r[key]).map(({ name, niche }) => ({ name, niche }));
  return { contacted: pick('contacted'), replied: pick('replied'), waiting: rows.filter((r) => r.waiting).length };
}

// Limpeza mensal: só os textos de conversas paradas. Saídas e o registro de quem já foi abordado ficam para sempre.
export async function botMarkAuto(ids) {
  if (ids.length) await pool.query(`UPDATE bot_messages SET source = 'auto' WHERE id = ANY($1) AND source = 'lead'`, [ids]);
}

// Um único lembrete para quem nunca respondeu (resposta automática não conta).
export const botDueFollowUp = async (sentBefore) => (await botRows(
  `SELECT c.* FROM bot_conversations c
   WHERE c.status = 'active' AND c.followup_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM bot_messages m WHERE m.lead_id = c.lead_id AND m.source = 'lead')
     AND (SELECT min(created_at) FROM bot_messages m WHERE m.lead_id = c.lead_id AND m.source = 'bot') < $1
   ORDER BY c.created_at LIMIT 1`,
  [sentBefore]
))[0] ?? null;

// Marca antes de enviar: um reinício no meio nunca manda o lembrete duas vezes.
export async function botMarkFollowUp(leadId) {
  const r = await pool.query(`UPDATE bot_conversations SET followup_at = now() WHERE lead_id = $1 AND status = 'active' AND followup_at IS NULL`, [leadId]);
  return r.rowCount === 1;
}

export async function botPurgeMessages(before) {
  const r = await pool.query(
    `DELETE FROM bot_messages m USING bot_conversations c
     WHERE m.lead_id = c.lead_id AND c.status NOT IN ('queued', 'sending', 'active') AND c.updated_at < $1`,
    [before]
  );
  return r.rowCount;
}

export const botQueuedCount = async () =>
  (await botRows(`SELECT count(*)::int AS n FROM bot_conversations WHERE status = 'queued'`))[0].n;

// Saída e estado na mesma instrução: não existe conversa ativa de quem pediu para sair.
export async function botMarkOptOut(leadId, phoneKey) {
  await pool.query(
    `WITH saved AS (INSERT INTO bot_optouts (phone_key) VALUES ($2) ON CONFLICT DO NOTHING)
     UPDATE bot_conversations SET status = 'opted_out', reason = NULL, updated_at = now() WHERE lead_id = $1`,
    [leadId, phoneKey]
  );
}

export const botIsOptedOut = async (phoneKey) =>
  (await botRows('SELECT 1 FROM bot_optouts WHERE phone_key = $1', [phoneKey])).length > 0;

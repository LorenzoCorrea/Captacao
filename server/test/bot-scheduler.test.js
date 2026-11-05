import test from 'node:test';
import assert from 'node:assert/strict';
import { tick, digestText, sendDigest, isThirdBusinessDay, monthlyPurge, businessDaysAgo } from '../src/bot/scheduler.js';
import { FIXED } from '../src/bot/offer.js';

// Quarta-feira, 10h no fuso local.
const WED_10 = new Date(2026, 10, 4, 10, 0, 0);
const WED_20 = new Date(2026, 10, 4, 20, 0, 0);
const SAT_10 = new Date(2026, 10, 7, 10, 0, 0);

const lead = (id, phone, hasWebsite = false) => ({ id, name: `Lead ${id}`, phone, hasWebsite, niche: 'barbearia' });

function setup({ config = {}, queued = [], leads = [], usage = {}, limits = {}, state = {}, known = new Map() } = {}) {
  queued = queued.map((c) => ({ ...c }));
  const log = { recovered: [], sent: [], statuses: [], replies: [], captures: 0, created: [], enriched: [], enqueued: [], usage: [], disabled: [], stages: [], notes: [] };
  const queue = [...queued];
  const settings = {
    botConfig: { enabled: true, cities: [{ name: 'POA', lat: -30, lng: -51 }], radiusKm: 5, niches: ['barbearia'], sendFrom: '09:00', sendTo: '18:00', weekdaysOnly: true, ...config },
    botState: state, limits: { whatsapp: 5, minSpacingMin: 8, ...limits },
    usage: { date: '2026-11-04', whatsapp: 0, lastAt: 0, ...usage },
  };
  const deps = {
    dbEnabled: () => true,
    settings: async () => settings,
    saveState: async (s) => { settings.botState = s; },
    db: {
      botDueReplies: async () => [],
      botNextQueued: async () => queue[0] ?? null,
      botEnqueue: async (c) => { log.enqueued.push(c); return true; },
      botGetByPhoneKey: async () => null,
      botClaim: async (conv) => { if (queue[0] !== conv) return false; conv.status = 'sending'; return true; },
      botTransition: async (id, from, status, reason) => {
        const conv = queue[0];
        if (!conv || conv.lead_id !== id || !from.includes(conv.status)) return false;
        conv.status = status;
        log.statuses.push([id, status, reason ?? null]);
        if (status !== 'queued') queue.shift();
        return true;
      },
      botGet: async (id) => (queue[0]?.lead_id === id ? { ...queue[0] } : null),
      botIsOptedOut: async () => false,
      botRecoverSending: async () => log.recovered,
      botAddMessage: async () => true,
      botQueuedCount: async () => queue.length,
      botDueFollowUp: async () => null,
      incrementUsage: async (canal) => { log.usage.push(canal); return {}; },
    },
    search: async () => { log.captures++; return { found: leads.length, leads }; },
    loadKnown: async () => known,
    createSearch: (l, _, { enrich }) => { (enrich ? log.enriched : log.created).push(l.map((x) => x.id)); return '11111111-1111-1111-1111-111111111111'; },
    gateway: {
      state: async () => 'open', isOnWhatsApp: async () => true,
      send: async (_, text) => { log.sent.push(text); return `id${log.sent.length}`; },
    },
    reply: async (c) => log.replies.push(c.lead_id),
    disableBot: async (r) => log.disabled.push(r),
    setStage: async (_, s) => log.stages.push(s),
    notify: async (t) => log.notes.push(t),
  };
  return { log, deps, settings };
}

const q = { lead_id: 'A', phone: '5551991234567', phone_key: '5191234567', name: 'Aurora', status: 'queued' };

test('desligado não capta, não envia nem responde', async () => {
  const { log, deps } = setup({ config: { enabled: false }, queued: [q] });
  deps.db.botDueReplies = async () => [q];
  await tick(WED_10, deps);
  assert.deepEqual([log.captures, log.sent.length, log.replies.length], [0, 0, 0]);
});

test('banco fora não faz nada', async () => {
  const { log, deps } = setup({ queued: [q] });
  deps.dbEnabled = () => false;
  await tick(WED_10, deps);
  assert.deepEqual([log.captures, log.sent.length], [0, 0]);
});

test('capta uma vez por dia só celular sem site', async () => {
  const leads = [lead('osm:1', '(51) 99123-4567'), lead('osm:2', '(51) 3333-4444'), lead('osm:3', '(51) 99999-8888', true), lead('osm:4', null)];
  const { log, deps } = setup({ leads });
  await tick(WED_10, deps);
  await tick(new Date(WED_10.getTime() + 60000), deps);
  assert.equal(log.captures, 1);
  assert.deepEqual(log.created, [['osm:1']]);
  assert.deepEqual(log.enriched, [['osm:2', 'osm:4']], 'sem celular vai procurar na internet');
  assert.deepEqual(log.enqueued.map((c) => [c.leadId, c.phone, c.phoneKey]), [['osm:1', '5551991234567', '5191234567']]);
});

test('celular achado na internet entra na fila; sem nada ou com site, não', async () => {
  const leads = [lead('osm:1', '(51) 3333-4444'), lead('osm:2', null), lead('osm:3', null), lead('osm:4', null)];
  const known = new Map([
    ['osm:1', { stage: 'novo', enrichmentStatus: 'done', enrichment: { mobilePhone: '(51) 99123-4567' } }],
    ['osm:2', { stage: 'novo', enrichmentStatus: 'done', enrichment: { mobilePhone: '(51) 99123-1111', discoveredWebsite: 'https://x.com.br' } }],
    ['osm:3', { stage: 'novo', enrichmentStatus: 'not_found' }],
  ]);
  const { log, deps } = setup({ leads, known });
  await tick(WED_10, deps);
  assert.deepEqual(log.enqueued.map((c) => [c.leadId, c.phone]), [['osm:1', '5551991234567']]);
  assert.deepEqual(log.enriched, [['osm:4']], 'só quem nunca foi procurado');
});

test('não aborda lead que Lorenzo já trabalhou no CRM', async () => {
  const leads = [lead('osm:1', '(51) 99123-4567'), lead('osm:2', '(51) 99123-1111'), lead('osm:3', '(51) 99123-2222')];
  const known = new Map([['osm:1', { stage: 'descartado' }], ['osm:2', { stage: 'ganho' }], ['osm:3', { stage: 'novo' }]]);
  const { log, deps } = setup({ leads, known });
  await tick(WED_10, deps);
  assert.deepEqual(log.enqueued.map((c) => c.leadId), ['osm:3']);
});

test('não captura quem já tem conversa', async () => {
  const { log, deps } = setup({ leads: [lead('osm:1', '(51) 99123-4567')] });
  deps.db.botGetByPhoneKey = async () => ({ lead_id: 'antigo' });
  await tick(WED_10, deps);
  assert.deepEqual([log.created, log.enqueued], [[], []]);
});

test('falha na captação tenta de novo só depois de 1 hora', async () => {
  const { log, deps } = setup();
  deps.search = async () => { log.captures++; throw new Error('sem base'); };
  await tick(WED_10, deps);
  await tick(new Date(WED_10.getTime() + 60000), deps);
  assert.equal(log.captures, 1);
  await tick(new Date(WED_10.getTime() + 3600001), deps);
  assert.equal(log.captures, 2);
});

test('envia com identificação, conta o uso e ativa a conversa', async () => {
  const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  await tick(WED_10, deps);
  assert.equal(log.sent.length, 1);
  assert.match(log.sent[0], /Lorenzo/);
  assert.match(log.sent[0], /Aurora/);
  assert.deepEqual(log.usage, ['whatsapp']);
  assert.deepEqual(log.statuses, [['A', 'active', null]]);
  assert.deepEqual(log.stages, ['contatado']);
});

for (const [name, at] of [['fora da janela', WED_20], ['sábado', SAT_10]]) {
  test(`não envia ${name}`, async () => {
    const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
    await tick(at, deps);
    assert.equal(log.sent.length, 0);
  });
}

test('sábado envia se a configuração permitir', async () => {
  const { log, deps } = setup({ queued: [q], config: { weekdaysOnly: false }, usage: { date: '2026-11-07' }, state: { lastCaptureDate: '2026-11-07' } });
  await tick(SAT_10, deps);
  assert.equal(log.sent.length, 1);
});

test('respeita limite diário e espaçamento', async () => {
  const atLimit = setup({ queued: [q], usage: { whatsapp: 5 }, state: { lastCaptureDate: '2026-11-04' } });
  await tick(WED_10, atLimit.deps);
  assert.equal(atLimit.log.sent.length, 0);
  const tooSoon = setup({ queued: [q], usage: { lastAt: WED_10.getTime() - 60000 }, state: { lastCaptureDate: '2026-11-04' } });
  await tick(WED_10, tooSoon.deps);
  assert.equal(tooSoon.log.sent.length, 0);
});

test('contador de ontem não bloqueia hoje', async () => {
  const { log, deps } = setup({ queued: [q], usage: { date: '2026-11-03', whatsapp: 5, lastAt: WED_10.getTime() - 60000 }, state: { lastCaptureDate: '2026-11-04' } });
  await tick(WED_10, deps);
  assert.equal(log.sent.length, 1);
});

test('número fora do WhatsApp vira failed sem contar no limite', async () => {
  const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  deps.gateway.isOnWhatsApp = async () => false;
  await tick(WED_10, deps);
  assert.deepEqual(log.statuses, [['A', 'failed', 'not_on_whatsapp']]);
  assert.deepEqual([log.sent, log.usage], [[], []]);
});

test('pausa durante a reserva: nada sai', async () => {
  const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  const isOn = deps.gateway.isOnWhatsApp;
  deps.gateway.isOnWhatsApp = async (p) => {
    const conv = await deps.db.botNextQueuedRef();
    conv.status = 'paused';
    return isOn(p);
  };
  deps.db.botNextQueuedRef = async () => log.claimed;
  const claim = deps.db.botClaim;
  deps.db.botClaim = async (c) => { log.claimed = c; return claim(c); };
  await tick(WED_10, deps);
  assert.deepEqual(log.sent, []);
  assert.deepEqual(log.statuses, []);
});

test('outro processo já reservou: não envia', async () => {
  const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  deps.db.botClaim = async () => false;
  await tick(WED_10, deps);
  assert.deepEqual(log.sent, []);
});

test('conta o uso antes de enviar; falha ao contar impede o envio e devolve à fila', async () => {
  const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  deps.db.incrementUsage = async () => { throw new Error('banco'); };
  await tick(WED_10, deps);
  assert.deepEqual(log.sent, []);
  assert.deepEqual(log.statuses, [['A', 'queued', null]]);
});

test('envio interrompido em reinício pausa para revisão e avisa', async () => {
  const { log, deps } = setup({ state: { lastCaptureDate: '2026-11-04' } });
  log.recovered = [{ lead_id: 'Z', name: 'Zeta', phone: '55' }];
  await tick(WED_10, deps);
  assert.equal(log.notes.length, 1);
  assert.match(log.notes[0], /Zeta/);
});

test('desligar no meio da rotina interrompe as respostas restantes', async () => {
  const { log, deps, settings } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  deps.db.botDueReplies = async () => [{ lead_id: 'P1' }, { lead_id: 'P2' }];
  deps.reply = async (c) => { log.replies.push(c.lead_id); settings.botConfig.enabled = false; };
  await tick(WED_10, deps);
  assert.deepEqual(log.replies, ['P1']);
  assert.deepEqual(log.sent, []);
});

test('desconectado desliga em vez de enviar', async () => {
  const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  deps.gateway.state = async () => 'close';
  await tick(WED_10, deps);
  assert.deepEqual(log.disabled, ['whatsapp_disconnected']);
  assert.equal(log.sent.length, 0);
  assert.deepEqual(log.statuses, [['A', 'queued', null]]);
});

test('erro no envio desliga o bot e não conta uso', async () => {
  const { log, deps } = setup({ queued: [q], state: { lastCaptureDate: '2026-11-04' } });
  deps.gateway.send = async () => { throw new Error('gateway'); };
  await tick(WED_10, deps);
  assert.deepEqual(log.disabled, ['send_failed']);
  assert.deepEqual(log.usage, ['whatsapp']);
  assert.deepEqual(log.statuses, [['A', 'paused', 'send_failed']]);
});

test('responde pendências, inclusive as anteriores a um reinício e à noite', async () => {
  const { log, deps } = setup({ state: { lastCaptureDate: '2026-11-04' } });
  deps.db.botDueReplies = async (sec) => { assert.equal(sec, 30); return [{ lead_id: 'P' }]; };
  await tick(WED_20, deps);
  assert.deepEqual(log.replies, ['P']);
});

test('resumo: texto com envios, respostas e espera', () => {
  const a = { name: 'Padaria Sol', niche: 'padaria' };
  const b = { name: 'Salão Lua', niche: 'salão' };
  assert.equal(digestText({ contacted: [], replied: [], waiting: 3 }, 5), null, 'sem novidade não avisa');
  assert.equal(digestText({ contacted: [a, b], replied: [], waiting: 2 }, 5),
    'Lorenzo, chamei 2 leads: Padaria Sol (padaria), Salão Lua (salão). Ainda espero resposta de 2.');
  assert.equal(digestText({ contacted: [], replied: [a], waiting: 0 }, 5),
    'Lorenzo, 1 respondeu nos últimos 5 min: Padaria Sol (padaria). Todos os contatados já responderam.');
});

test('resumo: a cada 5 min e só com novidade', async () => {
  const notes = [];
  const settings = {};
  let calls = 0;
  const deps = {
    dbEnabled: () => true,
    settings: async () => settings,
    saveDigestAt: async (at) => { settings.botDigestAt = at; },
    db: { botDigest: async () => { calls++; return { contacted: [{ name: 'X', niche: 'y' }], replied: [], waiting: 1 }; } },
    notify: async (t) => notes.push(t),
  };
  await sendDigest(WED_10, deps);
  assert.deepEqual([calls, notes.length], [0, 0], 'primeira rodada só marca');
  await sendDigest(new Date(WED_10.getTime() + 4 * 60000), deps);
  assert.equal(calls, 0, 'antes de 5 min');
  await sendDigest(new Date(WED_10.getTime() + 5 * 60000), deps);
  assert.deepEqual(notes, ['Lorenzo, chamei 1 lead: X (y). Ainda espero resposta de 1.']);
});

test('3º dia útil: pula fim de semana', () => {
  // Dezembro de 2026 começa numa terça: 1, 2, 3 → dia 3. Agosto de 2026 começa num sábado: 3, 4, 5 → dia 5.
  assert.equal(isThirdBusinessDay(new Date(2026, 11, 3, 10)), true);
  assert.equal(isThirdBusinessDay(new Date(2026, 11, 2, 10)), false);
  assert.equal(isThirdBusinessDay(new Date(2026, 7, 5, 10)), true);
  assert.equal(isThirdBusinessDay(new Date(2026, 7, 3, 10)), false);
});

test('limpeza: uma vez por mês, apagando o que é anterior ao mês', async () => {
  const calls = [];
  const notes = [];
  const settings = {};
  const deps = {
    dbEnabled: () => true,
    settings: async () => settings,
    savePurgedMonth: async (m) => { settings.botPurgedMonth = m; },
    purgeMessages: async (before) => { calls.push(before); return { bot: 4, evolution: 30 }; },
    notify: async (t) => notes.push(t),
  };
  await monthlyPurge(new Date(2026, 11, 2, 10), deps);
  assert.equal(calls.length, 0, 'ainda não é o 3º dia útil');
  await monthlyPurge(new Date(2026, 11, 3, 10), deps);
  await monthlyPurge(new Date(2026, 11, 3, 10, 1), deps);
  assert.equal(calls.length, 1, 'só uma vez no mês');
  assert.deepEqual(calls[0], new Date(2026, 11, 1));
  assert.match(notes[0], /4 mensagens.*30 cópias/);
});

test('dias úteis para trás pulam o fim de semana', () => {
  // Terça 10/11/2026 − 2 dias úteis = sexta 06/11.
  assert.deepEqual(businessDaysAgo(new Date(2026, 10, 10, 10), 2), new Date(2026, 10, 6, 10));
  assert.deepEqual(businessDaysAgo(new Date(2026, 10, 5, 10), 2), new Date(2026, 10, 3, 10));
});

const WED_15 = new Date(2026, 10, 4, 15, 0, 0);
const due = (followups = 0) => ({ lead_id: 'F', phone: '5551990000000', phone_key: '5190000000', name: 'Fulano', status: 'active', followups });

function withFollowUp(deps, conv) {
  const seen = { cutoffs: null, marked: [] };
  deps.db.botDueFollowUp = async (cutoffs) => { seen.cutoffs = cutoffs; return seen.marked.length ? null : conv; };
  deps.db.botMarkFollowUp = async (id, step) => { if (step !== conv.followups) return false; seen.marked.push(step); return true; };
  const get = deps.db.botGet;
  deps.db.botGet = async (id) => (id === 'F' ? { ...conv } : get(id));
  return seen;
}

test('lembrete: só à tarde, com cota própria e antes do lead novo', async () => {
  const { log, deps } = setup({ queued: [q], usage: { whatsapp: 5 } });
  const seen = withFollowUp(deps, due(0));
  await tick(WED_15, deps);
  assert.deepEqual(log.sent, [FIXED.followUp]);
  assert.deepEqual(log.usage, ['followup'], 'não gasta a vaga de lead novo');
  assert.deepEqual(seen.marked, [0]);
  // Prazos: 1º lembrete para quem foi chamado até terça; 2º para quem foi chamado até a sexta anterior.
  assert.deepEqual(seen.cutoffs, [new Date(2026, 10, 4), new Date(2026, 9, 31)]);
});

test('lembrete: de manhã não sai; a manhã é dos leads novos', async () => {
  const { log, deps } = setup({ queued: [q] });
  const seen = withFollowUp(deps, due(0));
  await tick(WED_10, deps);
  assert.equal(seen.cutoffs, null);
  assert.equal(log.sent.length, 1);
  assert.notEqual(log.sent[0], FIXED.followUp);
});

test('segundo lembrete é o último e se despede', async () => {
  const { log, deps } = setup();
  withFollowUp(deps, due(1));
  await tick(WED_15, deps);
  assert.deepEqual(log.sent, [FIXED.followUpLast]);
});

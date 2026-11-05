import test from 'node:test';
import assert from 'node:assert/strict';
import { tick } from '../src/bot/scheduler.js';

// Quarta-feira, 10h no fuso local.
const WED_10 = new Date(2026, 10, 4, 10, 0, 0);
const WED_20 = new Date(2026, 10, 4, 20, 0, 0);
const SAT_10 = new Date(2026, 10, 7, 10, 0, 0);

const lead = (id, phone, hasWebsite = false) => ({ id, name: `Lead ${id}`, phone, hasWebsite, niche: 'barbearia' });

function setup({ config = {}, queued = [], leads = [], usage = {}, limits = {}, state = {}, known = new Map() } = {}) {
  queued = queued.map((c) => ({ ...c }));
  const log = { recovered: [], sent: [], statuses: [], replies: [], captures: 0, created: [], enqueued: [], usage: [], disabled: [], stages: [], notes: [] };
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
      incrementUsage: async (canal) => { log.usage.push(canal); return {}; },
    },
    search: async () => { log.captures++; return { found: leads.length, leads }; },
    loadKnown: async () => known,
    createSearch: (l) => { log.created.push(l.map((x) => x.id)); return '11111111-1111-1111-1111-111111111111'; },
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
  assert.deepEqual(log.enqueued.map((c) => [c.leadId, c.phone, c.phoneKey]), [['osm:1', '5551991234567', '5191234567']]);
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

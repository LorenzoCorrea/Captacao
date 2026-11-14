// API dos pedidos para o APK. Só escuta em localhost; o Tailscale (tailscale serve) põe HTTPS na frente.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ConversaError } from './conversa.js';

const ID = /^[a-z0-9]{8}$/;
const FOTO_MAX = 15 * 1024 * 1024;
const JSON_MAX = 16 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const hash = (s) => createHash('sha256').update(String(s)).digest();

function readBody(req, max) {
  if (Number(req.headers['content-length']) > max) {
    req.resume();
    return Promise.reject(new HttpError(413, 'Arquivo grande demais.'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    // Lê até o fim mesmo passando do limite: cortar a conexão impediria a resposta 413.
    req.on('end', () => (size > max ? reject(new HttpError(413, 'Arquivo grande demais.')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

export function createServer({ store, captacao, runner, jobsDir, token, conversa }) {
  const esperado = hash(token);
  const autorizado = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    return Boolean(m) && timingSafeEqual(hash(m[1]), esperado);
  };
  const pedido = (id) => {
    const p = ID.test(id) ? store.get(id) : undefined;
    if (!p) throw new HttpError(404, 'Pedido não encontrado.');
    return p;
  };

  // Jarvis de voz: /jarvis/mensagens[/:id[/audio|/aprovacao]] e /jarvis/nova.
  async function rotaJarvis(req, res, [rec, id, acao], m) {
    const corpo = async () => {
      try { return JSON.parse((await readBody(req, JSON_MAX)).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON inválido.'); }
    };
    if (m === 'POST' && rec === 'nova' && !id) { await conversa.nova(); return send(res, 200, { ok: true }); }
    if (rec !== 'mensagens') throw new HttpError(404, 'Rota não encontrada.');
    if (m === 'POST' && !id) return send(res, 201, await conversa.enviar((await corpo()).texto));
    if (m === 'GET' && id && !acao) return send(res, 200, await conversa.estado(id));
    if (m === 'GET' && acao === 'audio') {
      const wav = conversa.audio(id);
      if (!wav) throw new HttpError(404, 'Sem áudio para esta mensagem.');
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      return res.end(wav);
    }
    if (m === 'POST' && acao === 'aprovacao') {
      const { aprovar } = await corpo();
      if (typeof aprovar !== 'boolean') throw new HttpError(400, 'Informe aprovar: true ou false.');
      await conversa.responder(id, aprovar);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'Rota não encontrada.');
  }

  async function rota(req, res) {
    const url = new URL(req.url, 'http://x');
    const partes = url.pathname.split('/').filter(Boolean);
    const [raiz, id, acao] = partes;
    const m = req.method;

    if (m === 'GET' && url.pathname === '/leads') return send(res, 200, { leads: await captacao.leads() });
    if (m === 'GET' && url.pathname === '/pedidos') return send(res, 200, { pedidos: store.list() });

    if (m === 'POST' && url.pathname === '/pedidos') {
      let body;
      try { body = JSON.parse((await readBody(req, JSON_MAX)).toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); }
      const lead = (await captacao.leads()).find((l) => l.leadId === body?.leadId);
      if (!lead) throw new HttpError(400, 'Este lead não pode receber prévia.');
      const observacao = typeof body.observacao === 'string' ? body.observacao.slice(0, 1000) : '';
      const p = store.create({ leadId: lead.leadId, leadName: lead.name, phone: lead.phone, observacao });
      const dir = join(jobsDir, p.id);
      mkdirSync(join(dir, 'fotos'), { recursive: true });
      writeFileSync(join(dir, 'lead.json'), JSON.stringify({ nome: lead.name, telefone: lead.phone, observacao }, null, 2));
      return send(res, 201, { id: p.id });
    }

    if (raiz === 'jarvis' && conversa) return rotaJarvis(req, res, partes.slice(1), m);
    if (raiz !== 'pedidos' || partes.length !== 3) throw new HttpError(404, 'Rota não encontrada.');
    const p = pedido(id);

    if (m === 'POST' && acao === 'fotos') {
      const ext = EXT[(req.headers['content-type'] ?? '').split(';')[0].trim()];
      if (!ext) throw new HttpError(415, 'Envie JPEG, PNG ou WebP.');
      if (p.estado !== 'recebendo') throw new HttpError(409, 'Este pedido já foi iniciado.');
      const foto = await readBody(req, FOTO_MAX);
      if (!foto.length) throw new HttpError(400, 'Foto vazia.');
      const n = p.fotos + 1;
      writeFileSync(join(jobsDir, id, 'fotos', `${String(n).padStart(2, '0')}.${ext}`), foto);
      store.update(id, { fotos: n });
      return send(res, 201, { fotos: n });
    }
    if (m === 'POST' && acao === 'iniciar') {
      if (p.estado !== 'recebendo') throw new HttpError(409, 'Este pedido já foi iniciado.');
      if (!p.fotos) throw new HttpError(400, 'Mande ao menos uma foto.');
      store.update(id, { estado: 'na_fila' });
      runner.kick();
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && acao === 'cancelar') {
      runner.stop(id);
      store.update(id, { estado: 'encerrado' });
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && acao === 'apagar') {
      await runner.stop(id);
      // shortcut: subpastas criadas pelo agente (usuário previas) podem resistir ao rm; o registro some mesmo assim.
      try { rmSync(join(jobsDir, id), { recursive: true, force: true }); } catch (e) { console.error('[jarvis-previas] apagar:', e.message); }
      store.remove(id);
      return send(res, 200, { ok: true });
    }
    if (m === 'GET' && acao === 'previa.pdf') {
      const file = join(jobsDir, id, 'saida', 'previa.pdf');
      if (!existsSync(file)) throw new HttpError(404, 'A prévia ainda não está pronta.');
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="previa-${id}.pdf"` });
      return res.end(readFileSync(file));
    }
    throw new HttpError(404, 'Rota não encontrada.');
  }

  return http.createServer(async (req, res) => {
    try {
      if (!autorizado(req)) throw new HttpError(401, 'Não autorizado.');
      await rota(req, res);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      const conhecido = e instanceof HttpError || e instanceof ConversaError;
      if (!conhecido) console.error('[jarvis-previas]', e);
      send(res, conhecido ? e.status : 500, { error: conhecido ? e.message : 'Erro interno.' });
    }
  });
}

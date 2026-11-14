// Ponte do app com a sessão do Jarvis de voz (Claude Code do usuário mordomo, em tmux).
// Uma mensagem por vez: digita na sessão, lê a resposta que o hook Stop grava em resposta.json,
// gera o áudio no Kokoro e detecta na tela quando o Jarvis pede aprovação (respondida pelo app).
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const MAX = 2000;
const OCIOSO = 6 * 60 * 60 * 1000;
const PERGUNTA = 'Do you want to proceed?';
const ACAO = /\/srv\/jarvis-voz\/bin\/agir(?= |$)[^\n│]*/gm;

export class ConversaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A ação pendente é a última linha de agir na tela, acima da pergunta de permissão.
function pedidoNaTela(tela) {
  const i = tela.lastIndexOf(PERGUNTA);
  if (i < 0) return undefined;
  const acoes = tela.slice(0, i).match(ACAO);
  return { acao: acoes ? acoes.at(-1).trim() : null };
}

export function createConversa({ tmux, respostaFile, falar, now = Date.now, esperaMax = 180000 }) {
  let atual = null;
  let ultimaEm = null;

  const lerResposta = () => {
    try { return JSON.parse(readFileSync(respostaFile, 'utf8')); } catch { return undefined; }
  };
  const doId = (id) => {
    if (!atual || atual.id !== id) throw new ConversaError(404, 'Mensagem não encontrada.');
    return atual;
  };

  return {
    async enviar(texto) {
      const limpo = String(texto ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX);
      if (!limpo) throw new ConversaError(400, 'Mensagem vazia.');
      if (atual && !atual.resultado && now() - atual.enviadoEm < esperaMax) throw new ConversaError(409, 'O Jarvis ainda está respondendo.');
      if (ultimaEm !== null && now() - ultimaEm > OCIOSO) await tmux.matar();
      if (!(await tmux.vivo())) await tmux.iniciar();
      await tmux.digitar(limpo);
      atual = { id: randomBytes(6).toString('hex'), enviadoEm: now() };
      ultimaEm = now();
      return { id: atual.id };
    },

    async estado(id) {
      const m = doId(id);
      if (m.resultado) return { estado: 'pronta', texto: m.resultado.texto, audio: Boolean(m.resultado.audio) };
      const r = lerResposta();
      if (r && r.em > m.enviadoEm) {
        // Uma só geração de áudio mesmo com várias consultas seguidas.
        m.falando ??= falar(r.texto).catch(() => null);
        const audio = await m.falando;
        m.resultado = { texto: r.texto, audio };
        ultimaEm = now();
        return { estado: 'pronta', texto: r.texto, audio: Boolean(audio) };
      }
      if (now() - m.enviadoEm > esperaMax) return { estado: 'erro', texto: 'O Jarvis não respondeu a tempo.', audio: false };
      const pedido = pedidoNaTela(await tmux.tela());
      if (pedido) {
        m.acaoVista = pedido.acao;
        return { estado: 'aguardando_aprovacao', acao: pedido.acao, audio: false };
      }
      return { estado: 'pensando', audio: false };
    },

    audio(id) {
      return atual?.id === id ? atual.resultado?.audio ?? undefined : undefined;
    },

    // Responde à pergunta de permissão só se a tela ainda mostra a mesma ação que o app exibiu.
    async responder(id, aprovar) {
      const m = doId(id);
      const pedido = pedidoNaTela(await tmux.tela());
      if (!pedido) throw new ConversaError(409, 'Não há pedido de aprovação agora.');
      if (!aprovar) return tmux.teclas('Escape');
      if (!pedido.acao) throw new ConversaError(409, 'Só ações do Jarvis podem ser aprovadas pelo app.');
      if (pedido.acao !== m.acaoVista) throw new ConversaError(409, 'O pedido mudou; confira de novo.');
      return tmux.teclas('1');
    },

    async nova() {
      await tmux.matar();
      atual = null;
      ultimaEm = null;
    },
  };
}

// Sessão real: tmux do mordomo (sudoers: lorenzo → mordomo só para /usr/bin/tmux).
export function tmuxDoMordomo({ nome = 'jarvis', cwd = '/srv/jarvis-voz/sessao', claude = '/home/mordomo/.local/bin/claude' } = {}) {
  const tmux = (...args) => new Promise((resolve) => {
    execFile('sudo', ['-n', '-u', 'mordomo', '-H', 'tmux', ...args], (err, stdout) => resolve({ ok: !err, saida: stdout ?? '' }));
  });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    vivo: async () => (await tmux('has-session', '-t', nome)).ok,
    async iniciar() {
      if (!(await tmux('new-session', '-d', '-x', '160', '-y', '50', '-s', nome, '-c', cwd, claude)).ok) throw new Error('não consegui abrir a sessão do Jarvis');
      // A primeira tela (boas-vindas) engole o que for digitado cedo demais.
      for (let i = 0; i < 30; i++) {
        await espera(1000);
        if ((await tmux('capture-pane', '-p', '-t', nome)).saida.includes('? for shortcuts')) break;
      }
      await espera(1500);
    },
    async digitar(texto) {
      await tmux('send-keys', '-t', nome, '-l', texto);
      await espera(300);
      await tmux('send-keys', '-t', nome, 'Enter');
    },
    tela: async () => (await tmux('capture-pane', '-p', '-t', nome)).saida,
    teclas: async (...k) => { await tmux('send-keys', '-t', nome, ...k); },
    matar: async () => { await tmux('kill-session', '-t', nome); },
  };
}

export async function falarNoKokoro(texto) {
  const r = await fetch('http://127.0.0.1:8096/falar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: texto.slice(0, 600) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`voz HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

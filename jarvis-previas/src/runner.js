// Fila dos pedidos: abre uma sessão do Claude Code (tmux, usuário previas) por pedido e acompanha o estado.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SESSAO = 6 * 60 * 60 * 1000;
const FECHAR_APOS_ENVIO = 60 * 1000;
const GUARDAR = 30 * 24 * 60 * 60 * 1000;
const ATIVOS = new Set(['montando', 'previa_pronta']);
const CLAUDE = '/home/previas/.local/bin/claude';

const sessao = (id) => `previa-${id}`;

// O lorenzo só pode rodar o tmux como previas (sudoers); a sessão herda o sandbox e as regras do Claude.
export function tmuxComoPrevias() {
  const tmux = (...args) => new Promise((resolve) => {
    execFile('sudo', ['-n', '-u', 'previas', '-H', 'tmux', ...args], (err) => resolve(!err));
  });
  return {
    async start(name, cwd, prompt) {
      if (!(await tmux('new-session', '-d', '-x', '160', '-y', '50', '-s', name, '-c', cwd, CLAUDE, prompt))) {
        throw new Error(`não consegui abrir a sessão ${name}`);
      }
    },
    alive: (name) => tmux('has-session', '-t', name),
    kill: (name) => tmux('kill-session', '-t', name),
  };
}

export function createRunner({ store, jobsDir, agentDir, tmux, now = Date.now, max = 2 }) {
  let rodando = Promise.resolve();

  async function iniciar(p) {
    const dir = join(jobsDir, p.id);
    copyFileSync(join(agentDir, 'CLAUDE.md'), join(dir, 'CLAUDE.md'));
    mkdirSync(join(dir, 'saida'), { recursive: true });
    chmodSync(join(dir, 'saida'), 0o2775);
    await tmux.start(sessao(p.id), dir, 'Monte a prévia deste pedido seguindo o CLAUDE.md.');
    store.update(p.id, { estado: 'montando', iniciadoEm: now() });
  }

  async function passo() {
    const t = now();
    for (const p of store.list()) {
      if (ATIVOS.has(p.estado)) {
        if (t - p.iniciadoEm > MAX_SESSAO) {
          await tmux.kill(sessao(p.id));
          store.update(p.id, { estado: 'encerrado', erro: 'tempo esgotado' });
        } else if (!(await tmux.alive(sessao(p.id)))) {
          store.update(p.id, { estado: 'encerrado' });
        } else if (p.estado === 'montando' && existsSync(join(jobsDir, p.id, 'saida', 'previa.pdf'))) {
          store.update(p.id, { estado: 'previa_pronta' });
        }
      } else if (p.estado === 'enviado' && t - p.enviadoEm > FECHAR_APOS_ENVIO && (await tmux.alive(sessao(p.id)))) {
        await tmux.kill(sessao(p.id));
      }
      if (!p.apagado && t - p.criadoEm > GUARDAR) {
        if (ATIVOS.has(p.estado)) await tmux.kill(sessao(p.id));
        // shortcut: arquivos que o agente criou em subpastas próprias podem resistir ao rm do lorenzo; se acumular, limpar com sudo.
        rmSync(join(jobsDir, p.id), { recursive: true, force: true });
        store.update(p.id, { apagado: true, ...(['recebendo', 'na_fila', ...ATIVOS].includes(p.estado) ? { estado: 'encerrado' } : {}) });
      }
    }
    const fila = store.list().filter((p) => p.estado === 'na_fila' && !p.apagado).reverse();
    let ativos = store.list().filter((p) => ATIVOS.has(p.estado)).length;
    for (const p of fila) {
      if (ativos >= max) break;
      try {
        await iniciar(p);
        ativos++;
      } catch (e) {
        store.update(p.id, { estado: 'erro', erro: e.message });
      }
    }
  }

  // Um passo por vez: o intervalo e o kick da API não podem abrir a mesma sessão duas vezes.
  const tick = () => (rodando = rodando.then(passo, passo));

  return {
    tick,
    kick: () => { tick().catch((e) => console.error('[jarvis-previas] runner:', e.message)); },
    stop: (id) => tmux.kill(sessao(id)),
  };
}

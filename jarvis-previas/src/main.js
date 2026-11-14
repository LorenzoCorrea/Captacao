// Sobe o jarvis-previas: API dos pedidos (só localhost) e o runner das sessões do Claude Code.
import { readFileSync } from 'node:fs';
import { createStore } from './store.js';
import { createCaptacao } from './captacao.js';
import { createServer } from './server.js';
import { createRunner, tmuxComoPrevias } from './runner.js';
import { createConversa, tmuxDoMordomo, falarNoKokoro } from './conversa.js';

const BASE = '/srv/jarvis-previas';
const config = JSON.parse(readFileSync(`${BASE}/config/config.json`, 'utf8'));

// Fotos e pastas legíveis pelo grupo previas (as sessões do agente).
process.umask(0o002);

const store = createStore(`${BASE}/data`);
const captacao = createCaptacao({ url: config.captacaoUrl, auth: config.captacaoAuth });
const runner = createRunner({ store, jobsDir: `${BASE}/jobs`, agentDir: `${BASE}/app/agent`, tmux: tmuxComoPrevias() });
const conversa = createConversa({ tmux: tmuxDoMordomo(), respostaFile: '/srv/jarvis-voz/estado/resposta.json', falar: falarNoKokoro });
const server = createServer({ store, captacao, runner, jobsDir: `${BASE}/jobs`, token: config.token, conversa });

server.listen(config.porta ?? 8095, '127.0.0.1', () => console.log(`[jarvis-previas] ouvindo em 127.0.0.1:${config.porta ?? 8095}`));
setInterval(() => runner.tick().catch((e) => console.error('[jarvis-previas] runner:', e.message)), 10000);
runner.tick().catch((e) => console.error('[jarvis-previas] runner:', e.message));

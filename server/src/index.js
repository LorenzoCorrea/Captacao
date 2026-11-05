import express from 'express';
import { fileURLToPath } from 'node:url';

// Carrega server/.env (se existir) ANTES de importar módulos que leem process.env.
try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch {}

// Imports dinâmicos: garantem que o .env já está em process.env quando o db.js inicializa o pool.
const { default: searchRouter } = await import('./routes/search.js');
const { initDb } = await import('./db.js');
const { createBotRouter } = await import('./routes/bot.js');
const { createRuntime } = await import('./bot/runtime.js');
const { startScheduler } = await import('./bot/scheduler.js');

const app = express();
app.use(express.json());
app.use(searchRouter);
const botRuntime = createRuntime();
app.use(createBotRouter(botRuntime));
startScheduler(botRuntime);

// No boot da máquina, API e Postgres sobem sem ordem garantida: sem repetir, a API ficaria em memória até reiniciar.
if (!(await initDb()) && process.env.DATABASE_URL) {
  const retry = setInterval(async () => {
    if (await initDb()) clearInterval(retry);
  }, 10000);
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`API de captação ouvindo em http://localhost:${PORT}`);
});

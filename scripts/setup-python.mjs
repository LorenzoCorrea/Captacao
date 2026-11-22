// Instala as dependências do worker em qualquer sistema: Windows usa `py`;
// Linux e macOS usam `python3`. Se já estiverem instaladas, não mexe no sistema.
import { spawnSync } from 'node:child_process';

const python = (process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py' : 'python3'));
const run = (...args) => spawnSync(python, args, { stdio: 'inherit' });

const check = spawnSync(python, ['-c', 'import httpx'], { stdio: 'ignore' });
if (check.error) {
  console.error(`Python não encontrado (${python}). Instale o Python 3 ou defina PYTHON_BIN.`);
  process.exit(1);
}
if (check.status === 0) {
  console.log('Dependências do worker Python já instaladas.');
  process.exit(0);
}

const install = run('-m', 'pip', 'install', '-r', 'workers/requirements.txt');
if (install.status !== 0) {
  console.error('Falha no pip. Em Debian/Ubuntu, ative um venv e rode de novo com PYTHON_BIN apontando para ele.');
  process.exit(1);
}

// Registro dos pedidos de prévia em data/pedidos.json (gravação atômica: .tmp + rename).
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789';
const novoId = () => Array.from(randomBytes(8), (b) => ALFABETO[b % ALFABETO.length]).join('');

export function createStore(dataDir, { now = Date.now } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'pedidos.json');
  let pedidos;
  try { pedidos = JSON.parse(readFileSync(file, 'utf8')); } catch { pedidos = {}; }

  const salvar = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(pedidos, null, 2));
    renameSync(`${file}.tmp`, file);
  };

  return {
    create({ leadId, leadName, phone, observacao }) {
      let id;
      do id = novoId(); while (pedidos[id]);
      const t = now();
      pedidos[id] = { id, leadId, leadName, phone, observacao: observacao ?? '', estado: 'recebendo', fotos: 0, criadoEm: t, atualizadoEm: t };
      salvar();
      return { ...pedidos[id] };
    },
    get: (id) => (Object.hasOwn(pedidos, id) ? { ...pedidos[id] } : undefined),
    list: () => Object.values(pedidos).sort((a, b) => b.criadoEm - a.criadoEm).map((p) => ({ ...p })),
    update(id, patch) {
      if (!Object.hasOwn(pedidos, id)) throw new Error(`pedido ${id} não existe`);
      pedidos[id] = { ...pedidos[id], ...patch, id, atualizadoEm: now() };
      salvar();
      return { ...pedidos[id] };
    },
  };
}

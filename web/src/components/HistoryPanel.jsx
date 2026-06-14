import { useEffect, useState } from 'react';

const fmtData = (s) => { try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return ''; } };

// Histórico de buscas salvas no banco. Clicar reabre a busca (re-hidrata do banco).
export default function HistoryPanel({ onOpen, onClose }) {
  const [items, setItems] = useState(undefined); // undefined = carregando

  useEffect(() => {
    let alive = true;
    fetch('/api/searches')
      .then((r) => r.json())
      .then((d) => alive && setItems(d.searches ?? []))
      .catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🕑 Buscas anteriores</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="modal-body">
          {items === undefined && <p className="empty">Carregando…</p>}
          {items && items.length === 0 && (
            <p className="empty">Nenhuma busca salva ainda. (O histórico precisa do banco de dados configurado.)</p>
          )}
          {items && items.length > 0 && (
            <ul className="history-list">
              {items.map((s) => (
                <li key={s.id} className="history-item" onClick={() => onOpen(s.id)}>
                  <div>
                    <strong className="history-niche">{s.niche}</strong> · {s.city || '—'}
                    <div className="muted">{s.leads} leads · {s.enriched} enriquecidos · {fmtData(s.created_at)}</div>
                  </div>
                  <span className="history-open">Abrir →</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

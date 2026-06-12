import { useMemo, useState } from 'react';

// Estágios do funil (espelham o back-end em enricher.js -> STAGES).
const STAGES = [
  { key: 'novo', label: 'Novo' },
  { key: 'qualificado', label: 'Qualificado' },
  { key: 'contatado', label: 'Contatado' },
  { key: 'ganho', label: 'Ganho' },
  { key: 'descartado', label: 'Descartado' },
];

export default function KanbanBoard({ leads, selectedId, onSelect, onMove }) {
  const [overCol, setOverCol] = useState(null);

  const byStage = useMemo(() => {
    const m = Object.fromEntries(STAGES.map((s) => [s.key, []]));
    for (const l of leads) (m[l.stage] ?? m.novo).push(l);
    return m;
  }, [leads]);

  return (
    <div className="kanban">
      {STAGES.map((st) => (
        <section
          key={st.key}
          className={`kanban-col ${overCol === st.key ? 'kanban-col--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (overCol !== st.key) setOverCol(st.key);
          }}
          onDragLeave={() => setOverCol((c) => (c === st.key ? null : c))}
          onDrop={(e) => {
            e.preventDefault();
            setOverCol(null);
            const id = e.dataTransfer.getData('text/plain');
            if (id) onMove(id, st.key);
          }}
        >
          <header className="kanban-col-head">
            {st.label} <span className="kanban-count">{byStage[st.key].length}</span>
          </header>
          <div className="kanban-cards">
            {byStage[st.key].map((l) => (
              <article
                key={l.id}
                className={`kanban-card ${l.id === selectedId ? 'kanban-card--sel' : ''}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)}
                onClick={() => onSelect(l.id)}
              >
                <strong>{l.name}</strong>
                {l.phone && <div className="muted">📞 {l.phone}</div>}
                <div className="kanban-contacts">
                  {l.enrichmentStatus === 'pending' && <span className="dot dot--wait" title="buscando contatos…" />}
                  {l.enrichment?.email && <span title={l.enrichment.email}>✉️</span>}
                  {l.enrichment?.instagram && <span title="Instagram">📷</span>}
                  {l.enrichment?.facebook && <span title="Facebook">📘</span>}
                  {l.enrichment?.linkedin && <span title="LinkedIn">🔗</span>}
                  {l.enrichmentStatus === 'not_found' && <span className="muted" style={{ fontSize: 11 }}>sem contato</span>}
                </div>
              </article>
            ))}
            {byStage[st.key].length === 0 && <div className="kanban-empty">arraste leads aqui</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

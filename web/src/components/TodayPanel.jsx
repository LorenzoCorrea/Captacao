import { useEffect, useMemo, useState } from 'react';
import { waLink } from '../lib/whatsapp.js';
import { igHandle, igUrl } from '../lib/instagram.js';
import { leadScore } from '../lib/score.js';

// Painel "📅 Hoje" — a disciplina do funil: a maioria das vendas B2B fecha
// entre o 3º e o 5º contato, e a maioria dos vendedores desiste no 1º.
// Três seções: follow-ups vencidos (todas as buscas, via banco), contatados
// parados há 3+ dias (banco) e quentes da busca atual ainda não abordados.

const hoje = () => new Date().toISOString().slice(0, 10);
const addDias = (base, dias) => {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const fmtBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export default function TodayPanel({ leads, searchId, onPatch }) {
  const [dbItems, setDbItems] = useState(null); // null = banco off/carregando

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/today');
        const j = await r.json();
        if (Array.isArray(j.items)) setDbItems(j.items);
      } catch { /* banco off: seções do banco ficam ocultas */ }
    })();
  }, []);

  // Com banco: follow-ups de TODAS as buscas. Sem banco: só da busca atual.
  const due = useMemo(() => {
    const src = dbItems ?? leads.map((l) => ({ ...l, searchId }));
    return src.filter((l) => l.followUpAt && l.followUpAt <= hoje() && !['ganho', 'descartado'].includes(l.stage));
  }, [dbItems, leads, searchId]);

  const stale = useMemo(
    () => (dbItems ?? []).filter((l) => !l.followUpAt && l.stage === 'contatado'),
    [dbItems]
  );

  const hot = useMemo(
    () => leads.filter((l) => l.stage === 'novo' && leadScore(l) >= 60).slice(0, 20),
    [leads]
  );

  // PATCH que funciona para lead de QUALQUER busca (o back re-hidrata do banco);
  // se for da busca aberta, usa o onPatch do App pra manter a tela em sincronia.
  function patch(item, fields) {
    if (item.searchId === searchId) {
      onPatch(item.id, fields);
    } else {
      fetch(`/api/search/${item.searchId}/leads/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      }).catch(() => {});
    }
    setDbItems((prev) => prev && prev.map((l) => (l.id === item.id ? { ...l, ...fields } : l)));
  }

  const adiar = (item) => patch(item, { followUpAt: addDias(item.followUpAt && item.followUpAt > hoje() ? item.followUpAt : hoje(), 3) });
  const concluir = (item) => patch(item, { followUpAt: null });

  function Item({ item, sub, children }) {
    const wa = waLink(item.phone, item.name, item.niche ?? item.searchNiche, item.enrichment?.ownerName);
    const ig = igHandle(item.enrichment?.instagram);
    return (
      <li className="today-item">
        <div className="today-info">
          <strong>{item.name}</strong>
          <span className="muted">{sub}</span>
        </div>
        <div className="today-actions">
          {wa && <a className="wa-btn wa-btn--sm" href={wa} target="_blank" rel="noreferrer">💬</a>}
          {!wa && ig && <a className="ig-btn" href={igUrl(ig)} target="_blank" rel="noreferrer">📷</a>}
          {children}
        </div>
      </li>
    );
  }

  const vazio = due.length === 0 && stale.length === 0 && hot.length === 0;

  return (
    <div className="today-wrap">
      <h2>📅 Hoje</h2>
      {vazio && <p className="empty">Nada pendente por aqui. Faça uma busca nova ou revise o Kanban. ✨</p>}

      {due.length > 0 && (
        <section>
          <h3>⏰ Follow-ups de hoje e vencidos ({due.length})</h3>
          <ul>
            {due.map((l) => (
              <Item key={`${l.searchId}-${l.id}`} item={l} sub={`retorno ${fmtBR(l.followUpAt)}${l.searchCity ? ` · ${l.searchCity}` : ''}${l.notes ? ` · 📝 ${l.notes.slice(0, 60)}` : ''}`}>
                <button type="button" className="details-btn" onClick={() => adiar(l)} title="Adiar 3 dias">+3d</button>
                <button type="button" className="details-btn" onClick={() => concluir(l)} title="Concluir follow-up">✅</button>
              </Item>
            ))}
          </ul>
        </section>
      )}

      {stale.length > 0 && (
        <section>
          <h3>🤐 Contatados sem resposta há 3+ dias ({stale.length})</h3>
          <ul>
            {stale.map((l) => (
              <Item key={`${l.searchId}-${l.id}`} item={l} sub={`${l.searchNiche ?? ''}${l.searchCity ? ` · ${l.searchCity}` : ''} — hora do 2º toque`}>
                <button type="button" className="details-btn" onClick={() => adiar(l)} title="Agendar retorno em 3 dias">🕑 +3d</button>
              </Item>
            ))}
          </ul>
        </section>
      )}

      {hot.length > 0 && (
        <section>
          <h3>🔥 Quentes desta busca ainda não abordados ({hot.length})</h3>
          <ul>
            {hot.map((l) => (
              <Item key={l.id} item={{ ...l, searchId }} sub={`score ${leadScore(l)} · ${l.address ?? ''}`} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

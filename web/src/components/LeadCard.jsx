import { waLink } from '../lib/whatsapp.js';

const stop = (ev) => ev.stopPropagation();

export default function LeadCard({ lead, selected, onSelect }) {
  const e = lead.enrichment;
  const wa = waLink(lead.phone, lead.name);
  return (
    <article className={`card ${selected ? 'card--selected' : ''}`} onClick={() => onSelect(lead.id)}>
      <header>
        <h3>{lead.name}</h3>
        {lead.rating != null && (
          <span className="rating">
            ⭐ {lead.rating} <small>({lead.reviewsCount})</small>
          </span>
        )}
      </header>
      <p className="muted">{lead.address}</p>
      {lead.phone && <p className="muted">📞 {lead.phone}</p>}

      {wa && (
        <a className="wa-btn" href={wa} target="_blank" rel="noreferrer" onClick={stop}>
          💬 Chamar no WhatsApp
        </a>
      )}

      <footer className="contacts">
        {lead.enrichmentStatus === 'pending' && <span className="chip chip--pending">🔎 buscando contatos…</span>}
        {lead.enrichmentStatus === 'not_found' && <span className="chip">nenhum contato encontrado</span>}
        {lead.enrichmentStatus === 'done' && e && (
          <>
            {e.email && (
              <a className="chip chip--ok" href={`mailto:${e.email}`} onClick={stop}>
                ✉️ {e.email}
              </a>
            )}
            {e.instagram && (
              <a className="chip chip--ok" href={e.instagram} target="_blank" rel="noreferrer" onClick={stop}>
                📷 Instagram
              </a>
            )}
            {e.facebook && (
              <a className="chip" href={e.facebook} target="_blank" rel="noreferrer" onClick={stop}>
                Facebook
              </a>
            )}
            {e.linkedin && (
              <a className="chip" href={e.linkedin} target="_blank" rel="noreferrer" onClick={stop}>
                LinkedIn
              </a>
            )}
          </>
        )}
      </footer>
    </article>
  );
}

import { waLink } from '../lib/whatsapp.js';
import { leadScore, scoreTier } from '../lib/score.js';

const stop = (ev) => ev.stopPropagation();

export default function LeadCard({ lead, selected, onSelect }) {
  const e = lead.enrichment;
  const wa = waLink(lead.phone, lead.name);
  const score = leadScore(lead);
  const tier = scoreTier(score);
  return (
    <article className={`card ${selected ? 'card--selected' : ''}`} onClick={() => onSelect(lead.id)}>
      <header>
        <h3>{lead.name}</h3>
        <span className={`score score--${tier.key}`} title={`Score de prospecção: ${score}/100`}>
          {tier.label} · {score}
        </span>
      </header>
      {lead.rating != null && (
        <p className="muted">⭐ {lead.rating} ({lead.reviewsCount} avaliações)</p>
      )}
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

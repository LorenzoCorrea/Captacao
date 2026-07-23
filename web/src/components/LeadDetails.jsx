import { useEffect, useState } from 'react';
import { igHandle, fmtSeguidores } from '../lib/instagram.js';

// Detalhes/CRM de um lead: anotações, data de retorno (follow-up), tags, valor
// estimado e timeline de interações. Salva via PATCH (persiste no banco).
const TAGS_SUGERIDAS = ['interessado', 'sem orçamento', 'follow-up', 'pediu proposta', 'fechou', 'sem interesse'];

// Tipos de interação (timeline): registro rápido de cada toque no lead.
const INTERACOES = [
  { type: 'msg', label: '💬 Enviei mensagem' },
  { type: 'reply', label: '↩️ Respondeu' },
  { type: 'call', label: '📞 Liguei' },
  { type: 'proposal', label: '📄 Proposta enviada' },
];
const rotulo = (i) => INTERACOES.find((x) => x.type === i.type)?.label ?? `📝 ${i.type}`;
const fmtQuando = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export default function LeadDetails({ lead, searchId, onSave, onClose }) {
  const [notes, setNotes] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [tags, setTags] = useState([]);
  const [value, setValue] = useState('');
  const [interactions, setInteractions] = useState([]);

  useEffect(() => {
    if (!lead) return;
    setNotes(lead.notes ?? '');
    setFollowUpAt(lead.followUpAt ?? '');
    setTags(lead.tags ?? []);
    setValue(lead.estimatedValue != null ? String(lead.estimatedValue) : '');
    setInteractions(lead.interactions ?? []);
  }, [lead]);

  if (!lead) return null;

  const toggleTag = (t) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  // Registro rápido: salva NA HORA (sem esperar o botão Salvar) — um toque
  // registrado na timeline nunca se perde por fechar o modal sem salvar.
  function registrar(type) {
    const next = [...interactions, { at: new Date().toISOString(), type }];
    setInteractions(next);
    onSave({ interactions: next });
  }

  function salvar() {
    onSave({ notes, followUpAt: followUpAt || null, tags, estimatedValue: value === '' ? null : Number(value) });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{lead.name}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="modal-body">
          <div className="lead-contacts">
            {lead.enrichment?.ownerName && (
              <span className="crm-chip" title={lead.enrichment.razaoSocial ?? ''}>👤 {lead.enrichment.ownerName}</span>
            )}
            {lead.enrichment?.cnpj && (
              <span className="crm-chip">
                🏢 CNPJ {lead.enrichment.cnpj}
                {lead.enrichment.companyAge != null && ` · ${lead.enrichment.companyAge} anos`}
                {lead.enrichment.porte && ` · ${lead.enrichment.porte}`}
              </span>
            )}
            {lead.phone && <span className="crm-chip">📞 {lead.phone}</span>}
            {lead.enrichment?.instagram && (
              <a className="crm-chip" href={lead.enrichment.instagram} target="_blank" rel="noreferrer">
                📷 {igHandle(lead.enrichment.instagram) ? `@${igHandle(lead.enrichment.instagram)}` : 'Instagram'}
                {fmtSeguidores(lead.enrichment.igFollowers) ? ` · ${fmtSeguidores(lead.enrichment.igFollowers)} seguidores` : ''}
              </a>
            )}
            {lead.enrichment?.email && <a className="crm-chip" href={`mailto:${lead.enrichment.email}`}>✉️ {lead.enrichment.email}</a>}
          </div>
          <label className="field">
            <span>📝 Anotações</span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: liguei dia 12, pediu pra retornar quinta de manhã..." />
          </label>
          <div className="field-row">
            <label className="field">
              <span>🕑 Retornar em</span>
              <input type="date" value={followUpAt ?? ''} onChange={(e) => setFollowUpAt(e.target.value)} />
            </label>
            <label className="field">
              <span>💰 Valor estimado (R$)</span>
              <input type="number" min="0" step="50" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
            </label>
          </div>
          <div className="field">
            <span>🏷️ Tags</span>
            <div className="tag-picker">
              {TAGS_SUGERIDAS.map((t) => (
                <button type="button" key={t} className={`tag-chip ${tags.includes(t) ? 'on' : ''}`} onClick={() => toggleTag(t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>📜 Interações <em>(clique para registrar — salva na hora)</em></span>
            <div className="tag-picker">
              {INTERACOES.map((i) => (
                <button type="button" key={i.type} className="tag-chip" onClick={() => registrar(i.type)}>{i.label}</button>
              ))}
            </div>
            {interactions.length > 0 && (
              <ul className="timeline">
                {[...interactions].reverse().map((i, idx) => (
                  <li key={`${i.at}-${idx}`}>
                    <span className="timeline-when">{fmtQuando(i.at)}</span> {rotulo(i)}
                    {i.note ? <span className="muted"> · {i.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <footer className="modal-foot">
          {searchId && (
            // Proposta em PDF na hora: usa o valor estimado salvo (senão "sob consulta")
            <a className="details-btn" href={`/api/search/${searchId}/leads/${lead.id}/proposta`} download>
              📄 Proposta (PDF)
            </a>
          )}
          <span className="spacer" />
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={salvar}>Salvar</button>
        </footer>
      </div>
    </div>
  );
}

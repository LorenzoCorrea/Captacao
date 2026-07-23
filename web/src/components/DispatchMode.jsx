import { useState } from 'react';
import { waLink, montarMensagem } from '../lib/whatsapp.js';
import { igHandle, igUrl } from '../lib/instagram.js';

// "Modo disparo" — abordagem em sequência, com humano no loop (respeita as
// regras do WhatsApp). Abre cada lead com a mensagem pronta; ao confirmar, o
// lead vai para "Contatado" e avança automaticamente para o próximo.
//
// Fallback de canal: lead SEM WhatsApp mas COM Instagram entra na fila também —
// o botão copia a mensagem e abre o perfil, você só cola na DM.
export default function DispatchMode({ leads, onContacted, onClose }) {
  const fila = leads.filter((l) => waLink(l.phone, l.name, l.niche) || igHandle(l.enrichment?.instagram));
  const [i, setI] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const done = i >= fila.length;
  const lead = fila[i];
  const wa = lead ? waLink(lead.phone, lead.name, lead.niche) : null;
  const ig = lead ? igHandle(lead.enrichment?.instagram) : null;

  function avancar() {
    onContacted?.(lead.id);
    setCopiado(false);
    setI((n) => n + 1);
  }

  function enviarWhatsApp() {
    if (wa) window.open(wa, '_blank', 'noopener');
    avancar();
  }

  async function enviarInstagram() {
    // Clipboard pode falhar (permissão/contexto http) — o preview na tela
    // continua disponível pra copiar na mão, então seguimos mesmo assim.
    try {
      await navigator.clipboard.writeText(montarMensagem(lead.name, lead.niche));
      setCopiado(true);
    } catch { /* usuário copia do preview */ }
    window.open(igUrl(ig), '_blank', 'noopener');
    avancar();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🚀 Modo disparo</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        {fila.length === 0 ? (
          <div className="modal-body"><p className="empty">Nenhum lead com WhatsApp ou Instagram na lista atual.</p></div>
        ) : done ? (
          <div className="modal-body"><p className="dispatch-done">✅ Você passou por todos os {fila.length} leads!</p></div>
        ) : (
          <div className="modal-body">
            <div className="dispatch-progress">
              <div className="dispatch-bar"><div style={{ width: `${(i / fila.length) * 100}%` }} /></div>
              <span>{i + 1} de {fila.length}</span>
            </div>
            <div className="dispatch-lead">
              <h3>{lead.name}</h3>
              {lead.phone && <p className="muted">📞 {lead.phone}</p>}
              {ig && <p className="muted">📷 @{ig}</p>}
            </div>
            <div className="preview">
              <span>Mensagem que será {wa ? 'aberta' : 'copiada'}:</span>
              <pre>{montarMensagem(lead.name, lead.niche)}</pre>
            </div>
            <p className="dispatch-hint">
              {wa ? (
                <>Ao clicar, a conversa abre pronta no WhatsApp (você só aperta enviar) e o lead vai para <strong>Contatado</strong>.</>
              ) : (
                <>Este lead não tem WhatsApp. Ao clicar, a mensagem é <strong>copiada</strong> e o perfil abre — cole na DM. O lead vai para <strong>Contatado</strong>.</>
              )}
            </p>
            {copiado && <p className="dispatch-hint">✅ Mensagem copiada!</p>}
          </div>
        )}

        <footer className="modal-foot">
          {!done && fila.length > 0 && (
            <button type="button" className="link-btn" onClick={() => { setCopiado(false); setI((n) => n + 1); }}>Pular</button>
          )}
          <span className="spacer" />
          <button type="button" className="btn-secondary" onClick={onClose}>{done || fila.length === 0 ? 'Fechar' : 'Parar'}</button>
          {!done && fila.length > 0 && (
            wa ? (
              <button type="button" className="wa-btn dispatch-send" onClick={enviarWhatsApp}>💬 Abrir e marcar contatado →</button>
            ) : (
              <button type="button" className="ig-btn dispatch-send" onClick={enviarInstagram}>📷 Copiar msg e abrir @{ig} →</button>
            )
          )}
        </footer>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { waLink, montarMensagem, variantOf, telefoneWhats } from '../lib/whatsapp.js';
import { igHandle, igUrl } from '../lib/instagram.js';
import { checkSend, registerSend, getUsage, loadLimits, fmtEspera } from '../lib/limits.js';

// "Modo disparo" — abordagem em sequência, com humano no loop. Abre cada lead
// com a mensagem pronta; ao confirmar, o lead vai para "Contatado" e avança.
//
// Fallback de canal: lead SEM WhatsApp mas COM Instagram entra na fila também —
// o botão copia a mensagem e abre o perfil, você só cola na DM.
//
// Proteção anti-ban: teto diário por canal + espaçamento mínimo entre envios
// (lib/limits.js). O botão TRAVA quando o limite é atingido — disparar frio em
// volume é o que derruba número no WhatsApp, e número novo cai mais rápido.
export default function DispatchMode({ leads, onContacted, onClose }) {
  const fila = leads.filter((l) => telefoneWhats(l) || igHandle(l.enrichment?.instagram));
  const [i, setI] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const [usage, setUsage] = useState(getUsage);
  const [, tick] = useState(0); // relógio: atualiza a contagem regressiva do espaçamento

  const done = i >= fila.length;
  const lead = fila[i];
  const dono = lead?.enrichment?.ownerName;
  const wa = lead ? waLink(telefoneWhats(lead), lead.name, lead.niche, dono, lead.id) : null;
  const ig = lead ? igHandle(lead.enrichment?.instagram) : null;
  const variante = lead ? variantOf(lead.id) : 'A';
  const canal = wa ? 'whatsapp' : 'instagram';
  const limits = loadLimits();
  const check = checkSend(canal, limits, usage);

  // Só liga o relógio enquanto o botão está travado pelo espaçamento.
  useEffect(() => {
    if (check.motivo !== 'espacamento') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [check.motivo]);

  function avancar(canalUsado) {
    setUsage(registerSend(canalUsado));
    onContacted?.(lead.id, canalUsado);
    setCopiado(false);
    setI((n) => n + 1);
  }

  function enviarWhatsApp() {
    if (wa) window.open(wa, '_blank', 'noopener');
    avancar('whatsapp');
  }

  async function enviarInstagram() {
    // Clipboard pode falhar (permissão/contexto http) — o preview na tela
    // continua disponível pra copiar na mão, então seguimos mesmo assim.
    try {
      await navigator.clipboard.writeText(montarMensagem(lead.name, lead.niche, undefined, dono, lead.id));
      setCopiado(true);
    } catch { /* usuário copia do preview */ }
    window.open(igUrl(ig), '_blank', 'noopener');
    avancar('instagram');
  }

  const rotuloCanal = canal === 'whatsapp' ? 'WhatsApp' : 'Instagram';

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

            <div className={`quota ${check.restantes === 0 ? 'quota--out' : ''}`}>
              🛡️ {rotuloCanal} hoje: <strong>{check.usados}/{check.teto}</strong>
              {check.restantes > 0 ? ` · restam ${check.restantes}` : ' · limite atingido'}
            </div>

            <div className="dispatch-lead">
              <h3>{lead.name}</h3>
              {dono && <p className="muted">👤 {dono}</p>}
              {lead.phone && <p className="muted">📞 {lead.phone}</p>}
              {ig && <p className="muted">📷 @{ig}</p>}
            </div>
            <div className="preview">
              <span>Mensagem que será {wa ? 'aberta' : 'copiada'} {variante === 'B' ? '· variante B' : ''}</span>
              <pre>{montarMensagem(lead.name, lead.niche, undefined, dono, lead.id)}</pre>
            </div>

            {check.motivo === 'limite-diario' && (
              <p className="dispatch-warn">
                🛑 Você já fez {check.teto} abordagens por {rotuloCanal} hoje. <strong>Pare por aqui.</strong>{' '}
                Insistir é o que derruba o número — continue amanhã ou use outro canal (e-mail, ligação).
                O limite é ajustável em <em>Editar mensagem do WhatsApp</em>.
              </p>
            )}
            {check.motivo === 'espacamento' && (
              <p className="dispatch-warn">
                ⏳ Aguarde <strong>{fmtEspera(check.esperaSeg)}</strong> antes do próximo envio — rajada é o
                padrão que o anti-spam detecta primeiro.
              </p>
            )}
            {check.ok && (
              <p className="dispatch-hint">
                {wa ? (
                  <>Ao clicar, a conversa abre pronta no WhatsApp (você só aperta enviar) e o lead vai para <strong>Contatado</strong>.</>
                ) : (
                  <>Este lead não tem WhatsApp. Ao clicar, a mensagem é <strong>copiada</strong> e o perfil abre — cole na DM. O lead vai para <strong>Contatado</strong>.</>
                )}
              </p>
            )}
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
              <button type="button" className="wa-btn dispatch-send" disabled={!check.ok} onClick={enviarWhatsApp}>
                💬 Abrir e marcar contatado →
              </button>
            ) : (
              <button type="button" className="ig-btn dispatch-send" disabled={!check.ok} onClick={enviarInstagram}>
                📷 Copiar msg e abrir @{ig} →
              </button>
            )
          )}
        </footer>
      </div>
    </div>
  );
}

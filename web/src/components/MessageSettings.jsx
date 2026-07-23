import { useEffect, useState } from 'react';
import {
  loadMsgConfig, saveMsgConfig, resetMsgConfig, DEFAULT_MSG_CONFIG,
  beneficiosToText, beneficiosFromText, montarMensagem,
} from '../lib/whatsapp.js';

// Editor da mensagem de abordagem do WhatsApp. A config fica no navegador
// (localStorage) — cada um ajusta o pitch sem mexer no código.
export default function MessageSettings({ open, onClose }) {
  const [template, setTemplate] = useState('');
  const [templateB, setTemplateB] = useState('');
  const [beneficios, setBeneficios] = useState('');
  const [padrao, setPadrao] = useState('');

  useEffect(() => {
    if (!open) return;
    const cfg = loadMsgConfig();
    setTemplate(cfg.template);
    setTemplateB(cfg.templateB ?? '');
    setBeneficios(beneficiosToText(cfg.beneficios));
    setPadrao(cfg.beneficioPadrao);
  }, [open]);

  if (!open) return null;

  const cfgAtual = { template, templateB, beneficios: beneficiosFromText(beneficios), beneficioPadrao: padrao };
  const preview = montarMensagem('Studio Aurora', 'salão de estética', cfgAtual, 'Maria Oliveira');

  function salvar() {
    saveMsgConfig(cfgAtual);
    onClose();
  }
  function restaurar() {
    resetMsgConfig();
    setTemplate(DEFAULT_MSG_CONFIG.template);
    setTemplateB('');
    setBeneficios(beneficiosToText(DEFAULT_MSG_CONFIG.beneficios));
    setPadrao(DEFAULT_MSG_CONFIG.beneficioPadrao);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>✏️ Mensagem do WhatsApp</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>Modelo da mensagem <em>(use {'{nome}'}, {'{dono}'} — 1º nome do sócio via CNPJ — e {'{beneficio}'})</em></span>
            <textarea rows={7} value={template} onChange={(e) => setTemplate(e.target.value)} />
          </label>
          <label className="field">
            <span>Variante B — teste A/B <em>(opcional; preenchida, metade dos leads recebe A e metade B, e o painel mostra qual converte mais)</em></span>
            <textarea rows={5} value={templateB} onChange={(e) => setTemplateB(e.target.value)} placeholder="Deixe vazio para usar só a mensagem principal." />
          </label>
          <label className="field">
            <span>Benefício por nicho <em>(1 por linha: palavras-chave =&gt; texto)</em></span>
            <textarea rows={6} value={beneficios} onChange={(e) => setBeneficios(e.target.value)} />
          </label>
          <label className="field">
            <span>Benefício padrão <em>(quando nenhum nicho casa)</em></span>
            <textarea rows={2} value={padrao} onChange={(e) => setPadrao(e.target.value)} />
          </label>
          <div className="preview">
            <span>Prévia — exemplo "Studio Aurora" (estética)</span>
            <pre>{preview}</pre>
          </div>
        </div>
        <footer className="modal-foot">
          <button type="button" className="link-btn" onClick={restaurar}>Restaurar padrão</button>
          <span className="spacer" />
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={salvar}>Salvar</button>
        </footer>
      </div>
    </div>
  );
}

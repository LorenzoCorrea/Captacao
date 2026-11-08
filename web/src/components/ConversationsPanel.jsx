import { useCallback, useEffect, useState } from 'react';
import { lerJson } from '../lib/api.js';

const STATUS = {
  queued: '⏳ Na fila',
  sending: '📤 Enviando',
  active: '🤖 Bot conversando',
  paused: '⏸ Pausada',
  ready_to_close: '✅ Aceitou: envie o pagamento',
  closed: '🏁 Finalizada',
  opted_out: '🚫 Pediu para sair',
  failed: '⚠️ Não enviada',
};

const REASON = {
  manual: 'Você pausou',
  owner_replied: 'Você respondeu pelo celular',
  media: 'O lead enviou áudio ou mídia',
  installments: 'Quer parcelar: gere o link',
  discount_insist: 'Insistiu em desconto',
  human_requested: 'Pediu para falar com você',
  asked_if_bot: 'Perguntou se é um robô',
  unknown: 'O bot não soube responder',
  turn_limit: 'Chegou ao limite de respostas',
  send_failed: 'Falha no envio: confira no celular',
  send_interrupted: 'Envio interrompido: confira no celular',
  ai_unavailable: 'A IA ficou indisponível',
  not_on_whatsapp: 'O número não usa WhatsApp',
  won: 'Negócio fechado',
  lost: 'Sem negócio',
  later: 'Disse que fica para outro momento',
  wrong_contact: 'Número não é desse comércio',
};
const reasonText = (r) => REASON[r] ?? r;

const DISABLED_REASON = {
  whatsapp_disconnected: 'o número desconectou',
  send_failed: 'houve falha no envio',
  owner_unresolved: 'não identifiquei o contato de uma resposta sua',
};

async function api(path, method = 'GET', body) {
  const r = await fetch(`/api/bot/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return lerJson(r);
}

function Settings({ config, onSaved, onError }) {
  const [form, setForm] = useState({ ...config, nichesText: (config.niches ?? []).join(', ') });
  const [cityQuery, setCityQuery] = useState('');
  const [options, setOptions] = useState([]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function searchCity(e) {
    e.preventDefault();
    try {
      const data = await lerJson(await fetch(`/api/geocode?q=${encodeURIComponent(cityQuery)}`));
      setOptions(data.results ?? []);
    } catch (err) { onError(err.message); }
  }
  function addCity(c) {
    set('cities', [...(form.cities ?? []).filter((x) => x.name !== c.label), { name: c.label, lat: c.lat, lng: c.lng }]);
    setOptions([]);
    setCityQuery('');
  }
  async function save() {
    try {
      await api('config', 'PUT', {
        cities: form.cities ?? [],
        niches: form.nichesText.split(',').map((n) => n.trim()).filter(Boolean),
        radiusKm: Number(form.radiusKm),
        sendFrom: form.sendFrom,
        sendTo: form.sendTo,
        weekdaysOnly: form.weekdaysOnly,
      });
      onSaved();
    } catch (err) { onError(err.message); }
  }

  return (
    <div className="stats-block bot-settings">
      <h3>Configurar captação</h3>
      <form onSubmit={searchCity} className="bot-row">
        <label>Cidade <input value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} /></label>
        <button type="submit" disabled={cityQuery.trim().length < 3}>Buscar</button>
      </form>
      {options.map((c) => <button type="button" key={c.label} className="tag-chip" onClick={() => addCity(c)}>+ {c.label}</button>)}
      <div className="bot-row">
        {(form.cities ?? []).map((c) => (
          <button type="button" key={c.name} className="tag-chip" onClick={() => set('cities', form.cities.filter((x) => x !== c))} aria-label={`Remover ${c.name}`}>{c.name} ×</button>
        ))}
      </div>
      <label>Nichos, separados por vírgula <input value={form.nichesText} onChange={(e) => set('nichesText', e.target.value)} /></label>
      <div className="bot-row">
        <label>Raio (km) <input type="number" min="0.5" max="30" step="0.5" value={form.radiusKm} onChange={(e) => set('radiusKm', e.target.value)} /></label>
        <label>Envia das <input type="time" value={form.sendFrom} onChange={(e) => set('sendFrom', e.target.value)} /></label>
        <label>até <input type="time" value={form.sendTo} onChange={(e) => set('sendTo', e.target.value)} /></label>
        <label className="bot-check"><input type="checkbox" checked={form.weekdaysOnly} onChange={(e) => set('weekdaysOnly', e.target.checked)} /> Só dias úteis (no sábado, só quem abre no sábado)</label>
      </div>
      <button type="button" className="msg-edit-btn" onClick={save}>Salvar configuração</button>
    </div>
  );
}

function Conversation({ item, simulate, onChanged, onError }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [finishing, setFinishing] = useState(false);
  const path = `conversations/${encodeURIComponent(item.lead_id)}`;

  const load = useCallback(async () => {
    try {
      setMessages((await api(path)).messages);
    } catch (e) { onError(e.message); }
  }, [path, onError]);

  useEffect(() => { if (open) load(); }, [open, load, item.updated_at]);

  async function act(action, body) {
    try {
      await api(`${path}/${action}`, 'POST', body);
      onChanged();
    } catch (e) { onError(e.message); }
  }
  async function simulateReply(e) {
    e.preventDefault();
    try {
      await api('simulate-reply', 'POST', { leadId: item.lead_id, text: draft });
      setDraft('');
      await load();
      onChanged();
    } catch (err) { onError(err.message); }
  }
  const { status } = item;
  return (
    <article className="stats-block bot-conv">
      <button type="button" className="bot-conv-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <strong>{item.name}</strong> · {item.phone}
        <span className="bot-status">{STATUS[status] ?? status}</span>
        {item.reason && <span className="muted"> {reasonText(item.reason)}</span>}
        {item.last_body && <span className="bot-last">Última: “{item.last_body}”</span>}
      </button>
      <div className="bot-row">
        {['queued', 'sending', 'active', 'ready_to_close'].includes(status) && <button type="button" onClick={() => act('pause')}>⏸ Pausar e assumir</button>}
        {['paused', 'ready_to_close'].includes(status) && <button type="button" onClick={() => act('resume')}>▶ Devolver ao bot</button>}
        {!['closed', 'opted_out'].includes(status) && !finishing && <button type="button" onClick={() => setFinishing(true)}>✅ Finalizar</button>}
        {finishing && (
          <>
            <button type="button" onClick={() => act('finish', { won: true })}>🎉 Fechou negócio</button>
            <button type="button" onClick={() => act('finish', { won: false })}>Não fechou</button>
            <button type="button" onClick={() => setFinishing(false)}>Cancelar</button>
          </>
        )}
      </div>
      {open && (
        <div className="bot-history">
          {messages.map((m) => (
            <p key={m.id} className={`bot-msg bot-msg--${m.source}`}>
              <small>{m.source === 'lead' ? 'Lead' : m.source === 'owner' ? 'Você' : 'Bot'}</small>{m.body}
            </p>
          ))}
          {simulate && status === 'active' && (
            <form onSubmit={simulateReply} className="bot-row">
              <label>Simular resposta do lead <input value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
              <button type="submit" disabled={!draft.trim()}>Enviar</button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

export default function ConversationsPanel() {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [qr, setQr] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api('status'), api('conversations')]);
      setStatus(s);
      setItems(c.conversations);
      setError(null);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => { if (status?.connection === 'open') setQr(null); }, [status?.connection]);

  async function toggle() {
    try {
      await api('enabled', 'PUT', { enabled: !status.config.enabled });
      await refresh();
    } catch (e) { setError(e.message); }
  }
  async function connect() {
    try {
      setQr((await api('connect', 'POST')).qr);
    } catch (e) { setError(e.message); }
  }

  const simulate = status?.mode === 'simulate';
  return (
    <section className="stats-panel bot-panel">
      <h2>💬 Conversas do bot</h2>
      {error && <div className="search-error" role="alert">{error}</div>}
      {simulate && <div className="search-error" role="status"><strong>Simulação:</strong> nada é enviado pelo WhatsApp.</div>}
      {status && (
        <div className="stats-block bot-status-bar">
          <p>
            Bot <strong>{status.config.enabled ? 'ligado' : 'desligado'}</strong>
            {!status.config.enabled && status.config.disabledReason && ` porque ${DISABLED_REASON[status.config.disabledReason] ?? status.config.disabledReason}`}
            {' · '}WhatsApp {status.connection === 'open' ? 'conectado' : 'desconectado'}
            {' · '}{status.sentToday} de {status.dailyLimit} envios hoje
          </p>
          <div className="bot-row">
            <button type="button" onClick={toggle}>{status.config.enabled ? '⏹ Desligar bot' : '▶ Ligar bot'}</button>
            {status.connection !== 'open' && <button type="button" onClick={connect}>📱 Conectar número</button>}
            <button type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>⚙️ Configurar</button>
          </div>
          {qr && <img className="bot-qr" src={qr} alt="QR code: no celular do bot, abra WhatsApp, Dispositivos conectados e leia o código" />}
        </div>
      )}
      {showSettings && status && <Settings key={JSON.stringify(status.config.cities)} config={status.config} onSaved={() => { setShowSettings(false); refresh(); }} onError={setError} />}
      {items.length === 0 && <p className="empty">Nenhuma conversa ainda.</p>}
      {items.map((item) => <Conversation key={item.lead_id} item={item} simulate={simulate} onChanged={refresh} onError={setError} />)}
    </section>
  );
}

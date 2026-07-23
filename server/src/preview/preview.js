// Prévia de site personalizada por lead — o "fechador": em vez de FALAR sobre
// um site, o lead VÊ o próprio negócio num site pronto. Servida em
// GET /previa/:searchId/:leadId como HTML standalone (zero dependências).
//
// Nota de alcance: o link só abre para quem alcança o servidor. Na Tailscale,
// você e o sócio; para MANDAR ao lead, exponha o app (Tailscale Funnel) ou
// mostre a prévia na conversa/presencialmente.

const normalize = (s) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Tema visual + copy por ramo. `kw` casa por substring com o nicho normalizado.
const THEMES = [
  {
    kw: ['estetic', 'beleza', 'salao', 'manicure', 'sobrancelha', 'cabelei', 'barbear', 'barbeiro', 'spa', 'maquia', 'unha', 'depila'],
    cor: '#b0316e', cor2: '#7c2050', emoji: '💇',
    tagline: 'Realce sua beleza com quem entende',
    servicos: [['✂️ Serviços completos', 'Do corte à finalização, tudo em um só lugar.'], ['📅 Agendamento fácil', 'Marque seu horário pelo WhatsApp em segundos.'], ['⭐ Atendimento de confiança', 'Profissionais experientes e produtos de qualidade.']],
  },
  {
    kw: ['advog', 'advocacia', 'jurid', 'contab', 'contador'],
    cor: '#1e3a5f', cor2: '#132741', emoji: '⚖️',
    tagline: 'Seriedade e experiência a serviço de você',
    servicos: [['🤝 Atendimento personalizado', 'Cada caso tratado com a atenção que merece.'], ['📋 Transparência total', 'Você informado em cada etapa do processo.'], ['🏛️ Tradição e confiança', 'Anos de atuação e clientes satisfeitos.']],
  },
  {
    kw: ['restaurante', 'lanchonete', 'pizz', 'hamburg', 'cafe', 'bistro', 'padaria', 'comida', 'confeitar'],
    cor: '#c2410c', cor2: '#7c2d12', emoji: '🍽️',
    tagline: 'Sabor que vira lembrança',
    servicos: [['📖 Cardápio completo', 'Veja pratos, preços e novidades sem sair de casa.'], ['🛵 Peça pelo WhatsApp', 'Seu pedido a uma mensagem de distância.'], ['🎉 Eventos e encomendas', 'Levamos nosso sabor para a sua ocasião especial.']],
  },
  {
    kw: ['dent', 'odonto', 'clinic', 'medic', 'saude', 'nutri', 'fisio', 'psicol', 'terap'],
    cor: '#0f766e', cor2: '#134e4a', emoji: '🩺',
    tagline: 'Cuidando de você com dedicação',
    servicos: [['📅 Agende sua consulta', 'Horários flexíveis, direto pelo WhatsApp.'], ['👩‍⚕️ Profissionais qualificados', 'Atendimento humano e atualizado.'], ['🏥 Estrutura completa', 'Conforto e tecnologia para o seu atendimento.']],
  },
  {
    kw: ['academia', 'fitness', 'crossfit', 'pilates', 'muscula'],
    cor: '#15803d', cor2: '#14532d', emoji: '💪',
    tagline: 'Seu melhor shape começa aqui',
    servicos: [['🏋️ Treinos para todos os níveis', 'Do iniciante ao avançado, com acompanhamento.'], ['📅 Matrícula sem burocracia', 'Comece hoje: chame no WhatsApp.'], ['⏰ Horários amplos', 'Treine no horário que funciona para você.']],
  },
  {
    kw: ['pet', 'veterin'],
    cor: '#b45309', cor2: '#78350f', emoji: '🐾',
    tagline: 'Amor e cuidado pelo seu melhor amigo',
    servicos: [['🛁 Banho & tosa', 'Seu pet limpinho e cheiroso.'], ['💉 Cuidados veterinários', 'Saúde do seu companheiro em dia.'], ['📅 Agende pelo WhatsApp', 'Praticidade para o seu dia a dia.']],
  },
  {
    kw: ['empreit', 'construt', 'reform', 'pedreir', 'engenh', 'mecanic', 'funilaria', 'oficina', 'serralher', 'marcen'],
    cor: '#374151', cor2: '#1f2937', emoji: '🔧',
    tagline: 'Serviço bem feito, no prazo combinado',
    servicos: [['📐 Orçamento sem compromisso', 'Mande fotos pelo WhatsApp e receba sua estimativa.'], ['🧰 Equipe experiente', 'Qualidade e capricho em cada detalhe.'], ['✅ Garantia do serviço', 'Compromisso com o resultado.']],
  },
];
const THEME_PADRAO = {
  cor: '#1f6feb', cor2: '#123c7a', emoji: '🏪',
  tagline: 'Qualidade e atendimento que fazem a diferença',
  servicos: [['⭐ Atendimento de confiança', 'Tradição e respeito com cada cliente.'], ['📍 Fácil de encontrar', 'Estamos pertinho de você.'], ['💬 Fale conosco', 'Tire dúvidas e faça seu pedido pelo WhatsApp.']],
};

const themeFor = (niche) => {
  const n = normalize(niche);
  return THEMES.find((t) => t.kw.some((k) => n.includes(k))) ?? THEME_PADRAO;
};

// Telefone BR -> wa.me (espelha web/src/lib/whatsapp.js, sem import cruzado)
function waDigits(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length < 10) return null;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return '55' + d;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function previewHtml(lead, { sellerWhats } = {}) {
  const t = themeFor(lead.niche);
  const wa = waDigits(lead.phone);
  const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`Olá, ${lead.name}! Vi o site de vocês e queria mais informações.`)}` : null;
  const ig = lead.enrichment?.instagram;
  const sellerHref = sellerWhats ? `https://wa.me/${waDigits(sellerWhats)}?text=${encodeURIComponent(`Gostei da prévia do site de ${lead.name}! Quero saber mais.`)}` : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(lead.name)} — prévia do site</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; color:#222; background:#fafafa; }
  .hero { background:linear-gradient(135deg,${t.cor},${t.cor2}); color:#fff; text-align:center; padding:72px 20px 88px; }
  .hero .emoji { font-size:52px; }
  .hero h1 { font-size:clamp(28px,6vw,44px); margin:12px 0 8px; }
  .hero p { font-size:clamp(15px,3vw,19px); opacity:.92; }
  .hero .cta { display:inline-block; margin-top:26px; background:#25d366; color:#fff; text-decoration:none;
    font-weight:700; padding:14px 28px; border-radius:999px; font-size:16px; box-shadow:0 4px 14px rgba(0,0,0,.25); }
  .cards { max-width:960px; margin:-44px auto 0; padding:0 20px; display:grid; gap:16px;
    grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
  .card { background:#fff; border-radius:14px; padding:24px; box-shadow:0 3px 16px rgba(0,0,0,.08); }
  .card h3 { font-size:17px; margin-bottom:8px; }
  .card p { font-size:14px; color:#555; line-height:1.5; }
  .contato { max-width:960px; margin:48px auto; padding:0 20px; text-align:center; }
  .contato h2 { font-size:24px; margin-bottom:14px; color:${t.cor2}; }
  .contato p { color:#444; margin:6px 0; }
  .contato a { color:${t.cor}; text-decoration:none; font-weight:600; }
  footer { text-align:center; color:#999; font-size:13px; padding:26px 20px 120px; }
  .faixa { position:fixed; left:0; right:0; bottom:0; background:#111; color:#fff; padding:14px 16px;
    display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap:wrap; font-size:14px; }
  .faixa a { background:#25d366; color:#fff; text-decoration:none; font-weight:700; padding:9px 18px; border-radius:999px; white-space:nowrap; }
</style>
</head>
<body>
  <section class="hero">
    <div class="emoji">${t.emoji}</div>
    <h1>${esc(lead.name)}</h1>
    <p>${esc(t.tagline)}</p>
    ${waHref ? `<a class="cta" href="${waHref}">💬 Fale conosco no WhatsApp</a>` : ''}
  </section>

  <section class="cards">
    ${t.servicos.map(([h, p]) => `<div class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('\n    ')}
  </section>

  <section class="contato">
    <h2>📍 Onde estamos</h2>
    <p>${esc(lead.address ?? '')}</p>
    ${lead.phone ? `<p>📞 ${esc(lead.phone)}</p>` : ''}
    ${ig ? `<p><a href="${esc(ig)}" target="_blank" rel="noreferrer">📷 Siga no Instagram</a></p>` : ''}
  </section>

  <footer>Prévia ilustrativa — o site final é personalizado com as fotos, cores e textos do seu negócio.</footer>

  <div class="faixa">
    <span>✨ <strong>${esc(lead.name)}</strong>, gostou? Este site pode estar no ar esta semana.</span>
    ${sellerHref ? `<a href="${sellerHref}">Quero meu site</a>` : ''}
  </div>
</body>
</html>`;
}

// Única fonte do que o bot pode afirmar. A IA usa os marcadores e nunca escreve
// valores: assim, um erro do modelo não vira um preço errado na conversa.
export const OFFER = {
  preco: 'R$ 550, com o site pronto e a hospedagem inclusos',
  prazo: 'até 4 dias corridos depois do sinal',
  sinal: 'sinal de 30% no Pix (R$ 165)',
  saldo: 'o restante (R$ 385) pode ser no Pix ou no cartão',
  parcelamento: 'dá para parcelar no cartão, com juros',
  renovacao: 'o domínio expira a cada 1 ano, e a renovação é de R$ 50 por ano, junto com a hospedagem',
  manutencao: 'nos 2 primeiros meses é grátis e sem limite, pronto até o próximo dia útil. Depois, são R$ 50 por dia útil de trabalho, pagos antes',
  refazer: 'refazer tudo, trocando layout ou estrutura, fica R$ 100 nos 2 primeiros meses',
};

// O nome vem do OpenStreetMap, editável por qualquer pessoa: não pode levar preço, link ou Pix.
const UNSAFE_NAME = /(https?:|www\.|\w\.\w{2,}|r\$|\bpix\b|\bchave\b|[{}@])/i;
const MAX_NAME = 60;

export function safeName(name) {
  const text = String(name ?? '').trim();
  return !text || text.length > MAX_NAME || UNSAFE_NAME.test(text) ? 'seu comércio' : text;
}

const FIRST = {
  A: 'Oi, tudo bem? Aqui é o Lorenzo, faço sites para comércios. Não encontrei um site de {nome} e acho que posso ajudar. Posso te contar como funciona? Se não fizer sentido, é só avisar que não te chamo mais.',
  B: 'Oi! Sou o Lorenzo, faço sites para comércios. Vi que {nome} ainda não tem um site próprio. Posso te explicar como funciona? Se não tiver interesse, é só me avisar que não te chamo mais.',
};

export function firstMessage(variant, name) {
  const template = FIRST[variant] ?? FIRST.A;
  return template.replace(/\{([^{}]*)\}/g, (_, key) => (key === 'nome' ? safeName(name) : OFFER[key]));
}

// Respostas críticas não passam pela IA.
export const FIXED = {
  accepted: `Que ótimo! O site fica R$ 550. Para eu começar, é só o ${OFFER.sinal}, e ${OFFER.saldo}. Só lembrando: ${OFFER.renovacao}. Já te passo os dados de pagamento por aqui.`,
  // Aceite depois de o lead já ter lido o preço: só o próximo passo.
  acceptedShort: `Que bom, fico feliz! Já te mando os dados do Pix para o sinal de R$ 165 e, assim que cair, começo o seu site. E ${OFFER.saldo}.`,
  installments: 'Dá sim, no cartão, com juros. Já te passo as condições por aqui.',
  discount: `Desconto eu não consigo fazer, mas ${OFFER.parcelamento}, se ajudar. O valor é ${OFFER.preco}.`,
  handoff: 'Deixa eu ver isso direitinho e já te respondo por aqui.',
  botQuestion: 'Esta parte do atendimento é automatizada, mas eu acompanho tudo e já assumo a conversa por aqui. — Lorenzo',
  goodbye: 'Tranquilo, não te chamo mais. Agradeço pelo retorno e bom trabalho!',
  // "Em outro momento" não é pedido de saída: despede sem bloquear o número.
  later: 'Tranquilo! Agradeço pelo retorno. Se futuramente fizer sentido, fico à disposição 👍',
  gatekeeper: 'Claro! Pode encaminhar para o responsável, por favor? Se ele quiser saber mais, é só me chamar por aqui. Obrigado!',
  busy: 'Tranquilo, sem pressa! Quando puder, é só me chamar por aqui.',
  followUp: 'Oi! Passando rapidinho para saber se viu minha mensagem. Se fizer sentido, te explico como funciona por aqui mesmo 😊',
  followUpLast: 'Oi, tudo bem? Vou parar de te chamar por aqui para não incomodar. Se em algum momento fizer sentido ter um site, é só me mandar uma mensagem 👍',
};

// O benefício muda com o ramo; `kw` casa por trecho do nicho sem acento.
const NICHE_BENEFITS = [
  [['clinic', 'consult', 'odonto', 'dent', 'estetic', 'fisio', 'nutri', 'psicol', 'medic', 'saude', 'veterin'], 'com os procedimentos, a equipe e a localização. Passa mais confiança para quem pesquisa antes de marcar e facilita o agendamento pelo WhatsApp'],
  [['academia', 'pilates', 'crossfit', 'fitness', 'muscula'], 'com as modalidades, os horários e os planos. Quem quer conhecer o espaço vê tudo antes de visitar e já chama no WhatsApp'],
  [['advoc', 'advog', 'jurid', 'contab', 'contador'], 'com as áreas de atuação e as formas de contato. Passa credibilidade para quem pesquisa no Google antes de ligar'],
  [['barbear', 'salao', 'beleza', 'manicure', 'cabelei', 'unha', 'sobrancelha'], 'com os serviços, a localização e um botão para agendar direto pelo WhatsApp'],
  [['restaurante', 'lanchonete', 'pizz', 'hamburg', 'padaria', 'confeit', 'cafe', 'comida'], 'com o cardápio, os horários e a localização, e um botão para pedir pelo WhatsApp'],
];
const DEFAULT_BENEFIT = 'com a cara de vocês. Assim fica mais fácil o cliente te encontrar na internet, ver o que você oferece e te chamar direto';

export function howItWorks(niche, withPreview = false) {
  const key = String(niche ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const benefit = NICHE_BENEFITS.find(([kw]) => kw.some((k) => key.includes(k)))?.[1] ?? DEFAULT_BENEFIT;
  return `Claro! Eu crio um site só do seu negócio, ${benefit}. ${withPreview ? 'Quer ver uma prévia de como ficaria o de vocês?' : 'Quer saber quanto fica?'}`;
}

export const previewText = (name, url) =>
  `Montei uma prévia rápida para ${safeName(name)}: ${url}\n\nÉ só um rascunho. No site final eu ajusto textos, fotos e cores do jeito que vocês quiserem. O que achou?`;

// Únicas respostas livres do bot: a IA escolhe o tópico e nunca escreve o texto.
export const ANSWERS = {
  how_it_works: howItWorks(''),
  price: `Fica ${OFFER.preco}. Para começar, é só um ${OFFER.sinal}, e em ${OFFER.prazo} está pronto. Só para você saber: ${OFFER.renovacao}. Vamos fazer o seu?`,
  deadline: `Fica pronto em ${OFFER.prazo} de R$ 165.`,
  payment: `Para começar, é só um ${OFFER.sinal}, e ${OFFER.saldo}. Se preferir, ${OFFER.parcelamento}.`,
  domain: `Sim: ${OFFER.renovacao}.`,
  maintenance: `Sobre alterações: ${OFFER.manutencao}.`,
  redo: `Se quiser mudar tudo depois: ${OFFER.refazer}.`,
  included: `Por R$ 550 está tudo incluso: hospedagem, domínio (o link do site), botão para o WhatsApp, localização e certificado de segurança. Ajustes nos 2 primeiros meses são por minha conta. Só para você saber: ${OFFER.renovacao}.`,
  one_time: `É pagamento único pelo site. A única coisa que se repete: ${OFFER.renovacao}.`,
};
// A prévia só existe com link público e busca salva; sem isso, o tópico cai para Lorenzo.
export const TOPICS = [...Object.keys(ANSWERS), 'preview'];
const MAX_TOPICS = 2;

// O lead não é lembrado do que já leu: a primeira menção sai completa, as seguintes caem.
const ONCE = [
  [OFFER.renovacao, [` Só para você saber: ${OFFER.renovacao}.`, ` Só lembrando: ${OFFER.renovacao}.`]],
  [OFFER.preco, [` O valor é ${OFFER.preco}.`]],
  [OFFER.saldo, [` E ${OFFER.saldo}.`]],
];

export function trimRepeats(text, said = '') {
  return ONCE.reduce((t, [fact, pieces]) => (said.includes(fact) ? pieces.reduce((acc, p) => acc.replace(p, ''), t) : t), text);
}

export function acceptedText(said = '') {
  return said.includes(OFFER.preco) ? trimRepeats(FIXED.acceptedShort, said) : FIXED.accepted;
}

function topicText(topic, { niche, name, previewUrl }) {
  if (topic === 'how_it_works') return howItWorks(niche, Boolean(previewUrl));
  if (topic === 'preview') return previewUrl ? previewText(name, previewUrl) : null;
  return ANSWERS[topic];
}

// ctx: { said, niche, name, previewUrl }
export function answerFor(topics, ctx = {}) {
  const said = ctx.said ?? '';
  if (!Array.isArray(topics) || !topics.length) return null;
  // A apresentação geral puxa a conversa e não faz sentido colada numa resposta específica.
  const specific = topics.filter((t) => t !== 'how_it_works');
  const unique = [...new Set(specific.length ? specific : topics)];
  if (unique.length > MAX_TOPICS || !unique.every((t) => TOPICS.includes(t))) return null;
  const texts = unique.map((t) => topicText(t, ctx));
  if (texts.some((t) => !t)) return null;
  const parts = [];
  for (const t of texts) parts.push(trimRepeats(t, said + parts.join(' ')));
  return parts.join('\n\n');
}

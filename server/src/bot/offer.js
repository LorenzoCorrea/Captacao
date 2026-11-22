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
  A: 'Oi, tudo bem? Aqui é o Lorenzo, faço sites para comércios. Não encontrei um site de {nome} e acho que posso ajudar. Posso te contar como funciona?',
  B: 'Oi! Sou o Lorenzo, faço sites para comércios. Vi que {nome} ainda não tem um site próprio. Posso te explicar como funciona?',
};

// Ramo reconhecido: abre pelo resultado que importa àquele dono; senão, A/B genérico.
export function firstMessage(variant, name, niche = '') {
  const hook = nicheOf(niche, name)?.hook;
  const template = hook ? `Oi, tudo bem? Aqui é o Lorenzo. ${hook} Vi que {nome} ainda não tem site próprio. Posso te mostrar como funciona?` : FIRST[variant] ?? FIRST.A;
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
  // A prévia é montada por Lorenzo com fotos e dados reais: o bot só aceita o pedido e pausa.
  previewCaption: 'Aqui está a prévia que montei para vocês. É um rascunho: no site final eu ajusto textos, fotos e cores do jeito que preferirem. O que acharam?',
  previewRequested: 'Combinado! Vou montar com calma, com as informações de vocês, e te mando por aqui assim que ficar pronta 😊',
  goodbye: 'Tranquilo, não te chamo mais. Agradeço pelo retorno e bom trabalho!',
  // "Em outro momento" não é pedido de saída: despede sem bloquear o número.
  later: 'Tranquilo! Agradeço pelo retorno. Se futuramente fizer sentido, fico à disposição 👍',
  gatekeeper: 'Claro! Pode encaminhar para o responsável, por favor? Se ele quiser saber mais, é só me chamar por aqui. Obrigado!',
  busy: 'Tranquilo, sem pressa! Quando puder, é só me chamar por aqui.',
  wrongContact: 'Ah, desculpa pelo engano! Obrigado por avisar e bom trabalho 🙏',
  followUpLast: 'Oi, tudo bem? Vou parar de te chamar por aqui para não incomodar. Se em algum momento fizer sentido ter um site, é só me mandar uma mensagem 👍',
  // Lead recebeu a prévia e não respondeu: 1 e 3 dias úteis depois.
  previewNudge: 'Oi, tudo bem? Conseguiu dar uma olhada na prévia do site? Se quiser, ajusto cores, textos e fotos do jeito que preferir. E, se gostar, consigo começar ainda esta semana.',
  previewNudgeLast: 'Oi! Vou parar de te chamar por aqui para não incomodar. A prévia fica com você: se quiser seguir com o site, é só me mandar uma mensagem 👍',
};

// Abertura e benefício mudam com o ramo. `kw` casa por trecho do nicho + nome, sem acento:
// "salão de beleza" no OSM também traz barbearias e estéticas, que o nome denuncia. A ordem importa.
const SALAO = 'com os serviços, a localização e um botão para agendar direto pelo WhatsApp';
const SAUDE = 'com os procedimentos, a equipe e a localização. Passa mais confiança para quem pesquisa antes de marcar e facilita o agendamento pelo WhatsApp';
const NICHES = [
  { kw: ['barbear', 'barber'], hook: 'Ajudo barbearias a aparecer no Google e receber agendamentos direto pelo WhatsApp.', benefit: SALAO },
  { kw: ['estetic'], hook: 'Ajudo estéticas a atrair quem pesquisa no Google antes de marcar um procedimento.', benefit: SAUDE },
  { kw: ['clinic', 'consult', 'odonto', 'dent', 'fisio', 'nutri', 'psicol', 'medic', 'saude', 'veterin'], hook: 'Ajudo profissionais da saúde a serem encontrados por quem pesquisa no Google antes de marcar.', benefit: SAUDE },
  { kw: ['rastre'], hook: 'Ajudo empresas de rastreamento a receber pedidos de cotação direto pelo WhatsApp.', benefit: 'com os planos, a cobertura e o app, e um botão para pedir cotação pelo WhatsApp. Passa confiança para quem pesquisa antes de contratar' },
  { kw: ['academia', 'pilates', 'crossfit', 'fitness', 'muscula'], hook: 'Ajudo academias a mostrar planos e horários para quem pesquisa no Google antes de visitar.', benefit: 'com as modalidades, os horários e os planos. Quem quer conhecer o espaço vê tudo antes de visitar e já chama no WhatsApp' },
  // Sem promessa de clientes: o Código de Ética da OAB veda captação.
  { kw: ['advoc', 'advog', 'jurid', 'contab', 'contador'], hook: 'Ajudo escritórios a passar credibilidade para quem pesquisa no Google antes de ligar.', benefit: 'com as áreas de atuação e as formas de contato. Passa credibilidade para quem pesquisa no Google antes de ligar' },
  { kw: ['salao', 'beleza', 'manicure', 'cabelei', 'unha', 'sobrancelha', 'hair', 'nail'], hook: 'Ajudo salões a aparecer no Google e receber agendamentos direto pelo WhatsApp.', benefit: SALAO },
  { kw: ['restaurante', 'lanchonete', 'pizz', 'hamburg', 'padaria', 'confeit', 'cafe', 'comida'], hook: 'Ajudo restaurantes a mostrar o cardápio e receber pedidos direto pelo WhatsApp.', benefit: 'com o cardápio, os horários e a localização, e um botão para pedir pelo WhatsApp' },
];
const DEFAULT_BENEFIT = 'com a cara de vocês. Assim fica mais fácil o cliente te encontrar na internet, ver o que você oferece e te chamar direto';

function nicheOf(niche, name = '') {
  const key = `${niche ?? ''} ${name ?? ''}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return NICHES.find(({ kw }) => kw.some((k) => key.includes(k)));
}

export function howItWorks(niche, name) {
  const benefit = nicheOf(niche, name)?.benefit ?? DEFAULT_BENEFIT;
  return `Claro! Eu crio um site só do seu negócio, ${benefit}. Quer que eu monte uma prévia de como ficaria o de vocês, sem compromisso?`;
}

// 1º lembrete com algo novo: pergunta se quer a prévia; quem monta é Lorenzo, depois do sim.
export const followUpPreview = (name) =>
  `Oi! Posso montar uma prévia de como ficaria o site de ${safeName(name)}, sem compromisso. Quer que eu faça?`;

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

function topicText(topic, { niche, name }) {
  if (topic === 'how_it_works') return howItWorks(niche, name);
  return ANSWERS[topic];
}

// ctx: { said, niche, name }
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

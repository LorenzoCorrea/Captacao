// Única fonte do que o bot pode afirmar. A IA usa os marcadores e nunca escreve
// valores: assim, um erro do modelo não vira um preço errado na conversa.
export const OFFER = {
  preco: 'R$ 550, já com o site e a hospedagem',
  prazo: '4 dias corridos depois do sinal',
  sinal: '30% de sinal no Pix (R$ 165), e começo depois disso',
  saldo: 'o restante (R$ 385) no Pix ou no cartão',
  parcelamento: 'dá para parcelar no cartão, com juros',
  renovacao: 'O domínio expira a cada 1 ano, e a renovação fica R$ 50 por ano, com a hospedagem',
  manutencao: 'nos 2 primeiros meses é grátis e sem limite, pronto até o próximo dia útil. Depois, R$ 50 por dia útil de trabalho, pagos antes',
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
  accepted: `Fechado! Para começar são ${OFFER.sinal}. Depois, ${OFFER.saldo}. ${OFFER.renovacao}. Já te passo os dados de pagamento por aqui.`,
  installments: 'Dá sim, no cartão, com juros. Já te passo as condições por aqui.',
  discount: `Desconto eu não consigo fazer. O valor é ${OFFER.preco}, e ${OFFER.parcelamento}.`,
  handoff: 'Deixa eu ver isso direitinho e já te respondo por aqui.',
  botQuestion: 'Esta parte do atendimento é automatizada, mas eu acompanho tudo e já assumo a conversa por aqui. — Lorenzo',
  goodbye: 'Sem problema, não te chamo mais. Obrigado e bom trabalho!',
};

// Únicas respostas livres do bot: a IA escolhe o tópico e nunca escreve o texto.
export const ANSWERS = {
  how_it_works: `Faço uma página só do seu comércio, pronta para os clientes te encontrarem. Fica ${OFFER.preco}, e entrego em ${OFFER.prazo}. ${OFFER.renovacao}. Quer que eu faça a sua?`,
  price: `Fica ${OFFER.preco}. ${OFFER.renovacao}. Quer que eu faça a sua?`,
  deadline: `Entrego em ${OFFER.prazo}.`,
  payment: `São ${OFFER.sinal}. Depois, ${OFFER.saldo}. Também ${OFFER.parcelamento}.`,
  domain: `${OFFER.renovacao}.`,
  maintenance: `Sobre alterações: ${OFFER.manutencao}.`,
  redo: `Se quiser mudar tudo depois: ${OFFER.refazer}.`,
  included: `Inclui a página do seu comércio e a hospedagem: ${OFFER.preco}. ${OFFER.renovacao}.`,
};
export const TOPICS = Object.keys(ANSWERS);
const MAX_TOPICS = 2;

export function answerFor(topics) {
  if (!Array.isArray(topics) || !topics.length) return null;
  const unique = [...new Set(topics)];
  if (unique.length > MAX_TOPICS || !unique.every((t) => Object.hasOwn(ANSWERS, t))) return null;
  return unique.map((t) => ANSWERS[t]).join('\n\n');
}

// Única fonte do que o bot pode afirmar. A IA usa os marcadores e nunca escreve
// valores: assim, um erro do modelo não vira um preço errado na conversa.
export const OFFER = {
  preco: 'R$ 550, com site e hospedagem inclusos',
  prazo: '4 dias corridos a partir do sinal',
  sinal: 'sinal de 30% no Pix (R$ 165), e o trabalho só começa depois dele',
  saldo: 'saldo de R$ 385 no Pix ou no cartão',
  parcelamento: 'parcelamento no cartão, com juros',
  renovacao: 'o domínio expira a cada 1 ano, e a renovação custa R$ 50 por ano, para domínio e hospedagem',
  manutencao: 'manutenções grátis e sem limite nos 2 primeiros meses após a entrega, prontas até o próximo dia útil; depois disso, R$ 50 por dia útil de trabalho, pagos antes',
  refazer: 'refazer tudo, trocando layout ou estrutura, custa R$ 100 nos 2 primeiros meses',
};

// O nome vem do OpenStreetMap, editável por qualquer pessoa: não pode levar preço, link ou Pix.
const UNSAFE_NAME = /(https?:|www\.|\w\.\w{2,}|r\$|\bpix\b|\bchave\b|[{}@])/i;
const MAX_NAME = 60;

export function safeName(name) {
  const text = String(name ?? '').trim();
  return !text || text.length > MAX_NAME || UNSAFE_NAME.test(text) ? 'seu comércio' : text;
}

const FIRST = {
  A: 'Olá, tudo bem? Aqui é o Lorenzo, eu crio sites para comércios. Procurei {nome} e não encontrei um site próprio. Faço uma landing page focada no seu negócio por {preco}, com entrega em {prazo}. Vale avisar: {renovacao}. Posso te contar como funciona? Se preferir não receber mensagens, é só responder "não quero".',
  B: 'Oi! Aqui é o Lorenzo. Crio landing pages para comércios, e vi que {nome} ainda não aparece com um site próprio. Um site ajuda quem procura no Google a encontrar vocês e chamar direto. Fica {preco}, com entrega em {prazo}. Só para ficar claro: {renovacao}. Quer saber mais? Se não tiver interesse, responda "não quero" e não envio mais nada.',
};

export function firstMessage(variant, name) {
  const template = FIRST[variant] ?? FIRST.A;
  return template.replace(/\{([^{}]*)\}/g, (_, key) => (key === 'nome' ? safeName(name) : OFFER[key]));
}

// Respostas críticas não passam pela IA.
export const FIXED = {
  accepted: `Que ótimo! Para começar, funciona assim: ${OFFER.sinal}. Depois, ${OFFER.saldo}. Já te passo os dados de pagamento por aqui.`,
  installments: `Tenho sim: ${OFFER.parcelamento}. Já te passo as condições por aqui.`,
  discount: `Não trabalho com desconto. O valor é ${OFFER.preco}, e também temos ${OFFER.parcelamento}.`,
  handoff: 'Deixa eu ver isso direitinho e já te respondo por aqui.',
  botQuestion: 'Boa pergunta! Esta parte do atendimento é automatizada, mas eu acompanho tudo e já assumo a conversa por aqui. — Lorenzo',
  goodbye: 'Tudo bem, não vou mais enviar mensagens. Obrigado pela atenção e bom trabalho!',
};

// Únicas respostas livres do bot: a IA escolhe o tópico e nunca escreve o texto.
export const ANSWERS = {
  how_it_works: `Funciona assim: crio uma landing page focada no seu comércio, por ${OFFER.preco}. A entrega é em ${OFFER.prazo}. Para começar, é o ${OFFER.sinal}. Quer que eu faça a sua?`,
  price: `O valor é ${OFFER.preco}. Quer que eu faça a sua?`,
  deadline: `A entrega é em ${OFFER.prazo}.`,
  payment: `Para começar, é o ${OFFER.sinal}. Depois, ${OFFER.saldo}. Também tenho ${OFFER.parcelamento}.`,
  domain: `Sobre o domínio: ${OFFER.renovacao}.`,
  maintenance: `Sobre manutenção: ${OFFER.manutencao}.`,
  redo: `Caso queira mudar tudo depois: ${OFFER.refazer}.`,
  included: `Está incluso a landing page focada no seu comércio e a hospedagem, por ${OFFER.preco}.`,
};
export const TOPICS = Object.keys(ANSWERS);
const MAX_TOPICS = 2;

export function answerFor(topics) {
  if (!Array.isArray(topics) || !topics.length) return null;
  const unique = [...new Set(topics)];
  if (unique.length > MAX_TOPICS || !unique.every((t) => Object.hasOwn(ANSWERS, t))) return null;
  return unique.map((t) => ANSWERS[t]).join('\n\n');
}

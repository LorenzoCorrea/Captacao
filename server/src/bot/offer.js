// Única fonte do que o bot pode afirmar. A IA usa os marcadores e nunca escreve
// valores: assim, um erro do modelo não vira um preço errado na conversa.
export const OFFER = {
  preco: 'R$ 550, com o site pronto e a hospedagem inclusos',
  prazo: '4 dias corridos depois do sinal',
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
  installments: 'Dá sim, no cartão, com juros. Já te passo as condições por aqui.',
  discount: `Desconto eu não consigo fazer, mas ${OFFER.parcelamento}, se ajudar. O site fica ${OFFER.preco}.`,
  handoff: 'Deixa eu ver isso direitinho e já te respondo por aqui.',
  botQuestion: 'Esta parte do atendimento é automatizada, mas eu acompanho tudo e já assumo a conversa por aqui. — Lorenzo',
  goodbye: 'Sem problema, não te chamo mais. Obrigado e bom trabalho!',
};

// Únicas respostas livres do bot: a IA escolhe o tópico e nunca escreve o texto.
export const ANSWERS = {
  how_it_works: 'Claro! Eu crio um site só do seu comércio, com a cara de vocês. Assim fica mais fácil o cliente te encontrar na internet, ver o que você oferece e te chamar direto. Quer saber quanto fica?',
  price: `Fica ${OFFER.preco}. Para começar, é só um ${OFFER.sinal}, e em ${OFFER.prazo} está pronto. Só para você saber: ${OFFER.renovacao}. Vamos fazer o seu?`,
  deadline: `Fica pronto em ${OFFER.prazo} de R$ 165.`,
  payment: `Para começar, é só um ${OFFER.sinal}, e ${OFFER.saldo}. Se preferir, ${OFFER.parcelamento}.`,
  domain: `Sim: ${OFFER.renovacao}.`,
  maintenance: `Sobre alterações: ${OFFER.manutencao}.`,
  redo: `Se quiser mudar tudo depois: ${OFFER.refazer}.`,
  included: `Inclui o site do seu comércio e a hospedagem: ${OFFER.preco}. Só para você saber: ${OFFER.renovacao}.`,
};
export const TOPICS = Object.keys(ANSWERS);
const MAX_TOPICS = 2;

export function answerFor(topics) {
  if (!Array.isArray(topics) || !topics.length) return null;
  const unique = [...new Set(topics)];
  if (unique.length > MAX_TOPICS || !unique.every((t) => Object.hasOwn(ANSWERS, t))) return null;
  return unique.map((t) => ANSWERS[t]).join('\n\n');
}

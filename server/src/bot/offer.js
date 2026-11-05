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

const NUMBER_WORDS = /\b(dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent\w+|trezent\w+|quatrocent\w+|quinhent\w+|seiscent\w+|setecent\w+|oitocent\w+|novecent\w+|mil|metade|dobro|grátis|gratuit\w+)\b/iu;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br|io|app|me|ly)\b)/i;
const EMAIL = /\S+@\S+/;
const MAX_LENGTH = 1000;

// Valida o texto cru da IA antes de expandir: os marcadores são os únicos valores aceitos.
export function renderReply(raw) {
  const text = String(raw ?? '').trim();
  const fail = (reason) => ({ ok: false, reason });
  if (!text) return fail('empty');
  if (text.length > MAX_LENGTH) return fail('length');
  for (const [, name] of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!Object.hasOwn(OFFER, name)) return fail('placeholder');
  }
  const free = text.replace(/\{[^{}]*\}/g, '');
  if (/[{}]/.test(free)) return fail('placeholder');
  if (/\d/.test(free)) return fail('digit');
  if (NUMBER_WORDS.test(free)) return fail('number-word');
  if (EMAIL.test(free)) return fail('email');
  if (LINK.test(free)) return fail('link');
  if (/\b(pix|chave)\b/i.test(free)) return fail('pix');
  return { ok: true, text: text.replace(/\{([^{}]*)\}/g, (_, name) => OFFER[name]) };
}

const FIRST = {
  A: 'Olá, tudo bem? Aqui é o Lorenzo, eu crio sites para comércios. Procurei {nome} e não encontrei um site próprio. Faço uma landing page focada no seu negócio por {preco}, com entrega em {prazo}. Vale avisar: {renovacao}. Posso te contar como funciona? Se preferir não receber mensagens, é só responder "não quero".',
  B: 'Oi! Aqui é o Lorenzo. Crio landing pages para comércios, e vi que {nome} ainda não aparece com um site próprio. Um site ajuda quem procura no Google a encontrar vocês e chamar direto. Fica {preco}, com entrega em {prazo}. Só para ficar claro: {renovacao}. Quer saber mais? Se não tiver interesse, responda "não quero" e não envio mais nada.',
};

export function firstMessage(variant, name) {
  const template = FIRST[variant] ?? FIRST.A;
  return template.replace(/\{([^{}]*)\}/g, (_, key) => (key === 'nome' ? name : OFFER[key]));
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

export function offerPromptBlock() {
  return Object.entries(OFFER).map(([name, text]) => `{${name}}: ${text}`).join('\n');
}

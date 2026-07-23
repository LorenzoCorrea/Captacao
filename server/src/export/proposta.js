import PDFDocument from 'pdfkit';

// Proposta comercial em PDF, 1 página, gerada na hora a partir do lead.
// Responder "quanto custa?" em 2 minutos com documento profissional — na hora
// em que o lead está quente — é meio caminho pro fechamento.
//
// Identidade do vendedor via .env (opcionais): SELLER_NAME, SELLER_WHATSAPP,
// SELLER_EMAIL. Valor: estimatedValue do lead; sem ele, "sob consulta".

const normalize = (s) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Escopo por ramo: o que o site do nicho precisa ter (fala a língua do cliente).
const ESCOPOS = [
  { kw: ['estetic', 'beleza', 'salao', 'barbear', 'manicure', 'spa', 'unha', 'sobrancelha', 'cabelei'], itens: ['Página inicial com fotos do espaço e dos trabalhos', 'Lista de serviços com preços', 'Agendamento pelo WhatsApp em 1 clique', 'Integração com Instagram', 'Google Maps e horários de atendimento'] },
  { kw: ['restaurante', 'lanchonete', 'pizz', 'hamburg', 'cafe', 'padaria', 'comida'], itens: ['Página inicial com fotos dos pratos', 'Cardápio digital atualizável por você', 'Pedidos pelo WhatsApp em 1 clique', 'Google Maps, horários e delivery', 'Integração com Instagram'] },
  { kw: ['advog', 'advocacia', 'jurid', 'contab', 'contador'], itens: ['Site institucional com áreas de atuação', 'Página da equipe e credenciais', 'Formulário de contato + WhatsApp', 'Blog para artigos (autoridade no Google)', 'Certificado de segurança (https)'] },
  { kw: ['dent', 'odonto', 'clinic', 'medic', 'saude', 'nutri', 'fisio', 'psicol'], itens: ['Site com especialidades e convênios', 'Agendamento de consultas pelo WhatsApp', 'Página da equipe com CRM/registro', 'Depoimentos de pacientes', 'Google Maps e horários'] },
];
const ESCOPO_PADRAO = ['Site profissional com a identidade do negócio', 'Textos e fotos organizados por seção', 'Botão de WhatsApp em todas as páginas', 'Google Maps, horários e redes sociais', 'Certificado de segurança (https)'];

const escopoFor = (niche) => {
  const n = normalize(niche);
  return ESCOPOS.find((e) => e.kw.some((k) => n.includes(k)))?.itens ?? ESCOPO_PADRAO;
};

const fmtBRL = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function propostaPdf(lead, { niche } = {}) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 64, right: 64 } });
  const seller = process.env.SELLER_NAME || 'Proposta comercial';
  const hoje = new Date();
  const validade = new Date(hoje);
  validade.setDate(validade.getDate() + 7);
  const fmtData = (d) => d.toLocaleDateString('pt-BR');
  const AZUL = '#1e3a5f';
  const CINZA = '#666666';

  // Cabeçalho
  doc.fontSize(20).fillColor(AZUL).font('Helvetica-Bold').text(seller);
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor(CINZA).font('Helvetica').text(`Proposta de website — ${fmtData(hoje)}`);
  doc.moveDown(0.6);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(AZUL).lineWidth(2).stroke();
  doc.moveDown(1);

  // Cliente
  doc.fontSize(13).fillColor('#111111').font('Helvetica-Bold').text('Preparada para:');
  doc.fontSize(15).fillColor(AZUL).text(lead.name);
  const dono = lead.enrichment?.ownerName;
  if (dono) doc.fontSize(11).fillColor(CINZA).font('Helvetica').text(`A/C: ${dono}`);
  if (lead.address) doc.fontSize(10).fillColor(CINZA).text(lead.address);
  doc.moveDown(1);

  // Escopo
  doc.fontSize(13).fillColor('#111111').font('Helvetica-Bold').text('O que está incluído');
  doc.moveDown(0.4);
  doc.fontSize(11).font('Helvetica').fillColor('#333333');
  for (const item of escopoFor(niche ?? lead.niche)) doc.text(`•  ${item}`, { indent: 8 });
  doc.text('•  Site responsivo: perfeito no celular, tablet e computador', { indent: 8 });
  doc.text('•  Publicação, domínio próprio e suporte na primeira semana', { indent: 8 });
  doc.moveDown(1);

  // Investimento
  doc.fontSize(13).fillColor('#111111').font('Helvetica-Bold').text('Investimento');
  doc.moveDown(0.3);
  const valor = lead.estimatedValue != null && lead.estimatedValue > 0 ? fmtBRL(lead.estimatedValue) : 'sob consulta';
  doc.fontSize(17).fillColor(AZUL).text(valor === 'sob consulta' ? 'Valor sob consulta' : `${valor} (único)`, { indent: 8 });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(CINZA).font('Helvetica').text('Condições de pagamento a combinar. Sem mensalidade obrigatória.', { indent: 8 });
  doc.moveDown(1);

  // Prazo e validade
  doc.fontSize(13).fillColor('#111111').font('Helvetica-Bold').text('Prazo e validade');
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica').fillColor('#333333');
  doc.text('•  Entrega: até 10 dias úteis após aprovação e envio do material', { indent: 8 });
  doc.text(`•  Esta proposta é válida até ${fmtData(validade)}`, { indent: 8 });
  doc.moveDown(1.4);

  // Contato
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#dddddd').lineWidth(1).stroke();
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor('#111111').font('Helvetica-Bold').text('Vamos conversar?');
  doc.fontSize(10).font('Helvetica').fillColor(CINZA);
  if (process.env.SELLER_WHATSAPP) doc.text(`WhatsApp: ${process.env.SELLER_WHATSAPP}`);
  if (process.env.SELLER_EMAIL) doc.text(`E-mail: ${process.env.SELLER_EMAIL}`);
  doc.text('Respondo em horário comercial. Obrigado pela oportunidade!');

  doc.end();
  return doc; // stream — o caller dá pipe na resposta
}

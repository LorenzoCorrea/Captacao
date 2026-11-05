# Automação de captação e conversa pelo WhatsApp

## Intenção

Lorenzo vende landing pages para comércios sem site. Hoje ele capta e aborda à mão. Ele quer que o sistema capte os leads, faça o primeiro contato pelo WhatsApp e conduza a conversa até o aceite. Ele acompanha tudo pelo celular, assume quando quiser e entra para enviar os dados de pagamento e fechar.

O sucesso é o sistema rodar sozinho, sem custo de software ou serviços, com poucos leads por dia e sem o bot prometer algo fora da oferta.

## Metas

- Captar diariamente leads com celular e sem site, a partir da base local `osm_places`.
- Enviar o primeiro contato respeitando os limites diários e o espaçamento que já existem no Captação.
- Conversar por IA gratuita, dentro de uma oferta fixa.
- Pausar a conversa pelo botão, automaticamente quando Lorenzo responder pelo celular e quando o lead aceitar.
- Avisar Lorenzo quando precisar dele ou quando algo falhar.

## Fora de escopo

- n8n, por enquanto.
- Enriquecimento pago de contatos. Só entram leads cujo celular já está na base.
- Follow-up automático de quem não responde.
- Geração automática do site, cobrança ou emissão de link de pagamento.

## O que não pode acontecer

- O bot citar preço, prazo, condição ou dado de pagamento fora da oferta.
- O bot enviar chave Pix ou link de pagamento.
- O bot falar junto com Lorenzo ou depois de pausado.
- Chamar de novo quem pediu para sair.
- Disfarçar a automação para evitar detecção, ou trocar de número para driblar um ban.
- O bot negar que é automático ou afirmar ser humano quando perguntado.

## Restrições

- **Custo zero.** Todas as peças precisam funcionar sem pagamento. Modelos gratuitos podem mudar ou sumir, e o sistema deve parar com segurança quando isso acontecer.
- **Número.** Lorenzo decidiu usar um número próprio por conexão não oficial, ciente de que isso pode violar os termos do WhatsApp e gerar ban.
- **Máquinas.** O ZimaOS tem cerca de 2 GB livres e guarda o Postgres. O notebook tem cerca de 3,5 GB livres e roda o Captação.
- **Segredos.** Chaves ficam só em `.env`, fora do Git. Nenhuma peça nova publica porta fora do notebook.

## Abordagens

| Abordagem | Vantagem | Custo |
|---|---|---|
| **A. Regras no Captação, sem n8n** | Menos peças e menos memória; regras testáveis; botões no mesmo sistema | Mudar o fluxo exige alterar código |
| B. Regras no Captação, com n8n | Agendamento e integrações visuais | Mais uma peça e até alguns GB a mais de memória |
| C. Tudo no n8n | Tudo visual | Regras de preço difíceis de testar, e os botões ainda ficariam no Captação |

Lorenzo delegou a escolha, pedindo que tudo seja gratuito e funcione. **Escolhida: A.**

## Oferta

Esta tabela é a única fonte do que o bot pode afirmar.

| Item | Regra |
|---|---|
| Produto | Landing page focada no comércio do cliente |
| Preço | R$ 550, com site e hospedagem inclusos |
| Prazo | Até 4 dias corridos, contados a partir do sinal |
| Sinal | 30% no Pix (R$ 165). O trabalho só começa depois dele |
| Saldo | R$ 385, no Pix ou no cartão |
| Parcelamento | Disponível no cartão, com juros, por link do Mercado Pago gerado por Lorenzo. O bot não informa parcelas |
| Desconto | Não há |
| Domínio | Expira a cada 1 ano. A primeira mensagem não cita a oferta; o aviso vai junto de todo preço e do aceite |
| Renovação | R$ 50 por ano, para domínio e hospedagem |
| Manutenção nos 2 primeiros meses após a entrega | Grátis e sem limite de pedidos, pronta até o próximo dia útil |
| Refazer tudo nesses 2 meses | R$ 100 (trocar layout ou estrutura). Em caso de dúvida, passa para Lorenzo |
| Manutenção depois de 2 meses | R$ 50 por dia útil de trabalho, pagos antes. Se não couber em um dia, Lorenzo avisa o valor antes |

## Como funciona

```text
base local → captação diária → fila → gateway do WhatsApp ⇄ regras do Captação ⇄ 9router → modelo gratuito
```

### Peças novas

- **Evolution API**, em container no notebook, sem porta publicada. O Captação fala com ela pela rede interna do Docker. Autenticação por chave no `.env`. A pareação do número é por QR code.
- **9router**, em container no notebook, sem porta publicada, usando modelos gratuitos configurados pelo seu painel local.

### Dados

Tabelas novas no Postgres, criadas pelo `DDL` de `server/src/db.js`:

- `bot_conversations`: `lead_id` (chave), `phone` (único), `status`, `reason`, `ai_turns`, `updated_at`. Os estados são `queued`, `active`, `paused`, `ready_to_close`, `closed`, `opted_out` e `failed`.
- `bot_messages`: `id` do gateway (chave, garante que webhook repetido não seja processado duas vezes), `lead_id`, `direction`, `source` (`bot`, `lead` ou `owner`), `body`, `created_at`.
- `bot_optouts`: `phone` (chave) e `created_at`. Nunca é apagada por limpeza de leads.

A configuração fica em `app_settings`: `botConfig` com cidades, raio, nichos, horário de envio e o interruptor geral, além do `limits` que já existe.

### Captação

Uma rotina na API roda a cada hora e age uma vez por dia, para sobreviver a reinícios. Para cada cidade e nicho configurados, ela reutiliza `buscarEstabelecimentos` e `createSearch`, sem enriquecimento. Só entra na fila quem tem celular brasileiro válido, não tem site, não está em `bot_optouts` e nunca teve conversa.

Se a API não alcançar o banco, a rotina não faz nada.

### Envio

Dentro da janela configurada, a rotina pega o próximo da fila se `checkSend` equivalente permitir, usando `incrementUsage`. O padrão continua 5 por dia e 8 minutos entre envios. A verificação do limite é refeita no servidor, antes de cada envio.

### Conversa

A cada mensagem recebida por webhook autenticado:

1. Grava com o `id` do gateway e ignora repetidas.
2. Mensagem com `fromMe` que não foi enviada pelo bot é de Lorenzo: pausa a conversa, com motivo `owner_replied`.
3. Pedido claro de saída ("não quero", "pare", "sair" e semelhantes) é detectado por código, antes da IA: grava em `bot_optouts`, envia uma única despedida e encerra.
4. Se a conversa não está `active`, só grava.
5. Espera 30 s para juntar mensagens seguidas do mesmo lead.
6. Chama a IA com a oferta e o histórico. O texto do lead é tratado como dado não confiável, e a IA não tem ferramentas.
7. A IA responde um JSON com `intent` e `topics`. Os valores de `intent` são `continue`, `accepted`, `installments`, `discount`, `unknown`, `human_requested`, `asked_if_bot` e `opt_out`.
8. O código escolhe o texto pronto, relê o estado e só então envia.

### Regras por código

A IA não escreve texto: ela só classifica a mensagem em uma intenção e até dois tópicos, e o código envia as respostas prontas de `server/src/bot/offer.js`. Tópico desconhecido ou caso fora da lista passa para Lorenzo. O estado é gravado antes do envio, e um erro de envio nunca gera reenvio: a conversa pausa e o bot desliga.

A saída por `intent`:

- `accepted`: envia a explicação do sinal, muda para `ready_to_close`, pausa e avisa Lorenzo com um resumo.
- `installments`: responde que o parcelamento tem juros, pausa e avisa Lorenzo para gerar o link.
- `human_requested` e `unknown`: avisa o lead que Lorenzo vai responder, pausa e avisa.
- `discount`: responde que não há desconto e continua. Se insistir, pausa.
- `opt_out`: mesmo tratamento do passo 3.

Conversa com mais de 10 respostas da IA pausa e avisa Lorenzo.

### Falhas

- **IA fora do ar ou sem modelo gratuito:** nada é enviado. Tenta de novo a cada 5 minutos por 1 hora, depois pausa e avisa.
- **Número desconectado ou erro no gateway:** o interruptor geral desliga, a fila para, e a tela mostra o aviso. Lorenzo religa à mão depois de resolver.
- **Banco fora do ar:** a conversa não avança. A fila de gravações existente não serve aqui, porque o bot não deve responder sem histórico.
- **Avisos:** vão pelo próprio gateway para o número pessoal de Lorenzo (`OWNER_WHATSAPP`). Se o gateway cair, aparecem só na tela.

### Tela

Uma visão nova, "Conversas", junto de Mapa, Kanban, Painel e Hoje, que funciona no celular:

```text
Studio Aurora · (51) 99123-4567     🤖 Bot conversando
Última: "quanto fica o site?"
[⏸ Pausar e assumir]  [▶ Devolver ao bot]  [✅ Finalizar]
```

- Abrir uma conversa mostra o histórico completo.
- Um interruptor geral liga ou desliga o bot, com indicação de número conectado e envios do dia.
- Configurações ficam na tela existente de mensagens.

O Kanban acompanha: primeiro envio vai para `contatado`, `ready_to_close` para `qualificado`, Finalizar pergunta se ganhou (`ganho`) ou não (`descartado`), e saída vai para `descartado`.

### Transparência

As mensagens saem em nome de Lorenzo, em primeira pessoa, sem citar automação na apresentação (decisão de Lorenzo). Se o lead perguntar se fala com robô, IA ou uma pessoa, o bot responde com texto fixo que o atendimento é automatizado, pausa e avisa Lorenzo. Modelos gratuitos podem usar os dados recebidos para treinamento, então o histórico enviado contém só o necessário: nome do comércio e mensagens da conversa.

## Ordem de entrada em produção

1. **Simulação:** tudo funciona, mas nada sai pelo WhatsApp. As respostas ficam na tela.
2. **Teste com números próprios de Lorenzo:** cobrir aceite, desconto, parcelamento, saída, pausa e resposta pelo celular.
3. **1 lead por dia**, com acompanhamento.
4. **Até 5 por dia**, se não houver problema.

## Decisões de quem construir

Antes de programar sobre as peças novas, comprovar em um teste curto que o 9router atende por uma rota gratuita em português, retornando JSON utilizável, e que a Evolution API sobe, pareia e entrega webhook com o `fromMe`. Se o 9router não servir, usar o endpoint gratuito de Gemini ou Groq diretamente, com a mesma interface compatível com OpenAI.

Ficam para quem construir os detalhes de esquema, as palavras exatas de saída além das citadas, os textos de aviso e o layout da tela, seguindo os componentes existentes.

## Ainda a definir por Lorenzo

- Texto da apresentação e primeira mensagem.
- Número pessoal que recebe os avisos.
- Cidades, raio, nichos e horário de envio iniciais.

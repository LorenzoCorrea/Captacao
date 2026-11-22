# Funil automático: do "quero a prévia" ao fechamento

Data: 22/11/2026. Status: aguardando aprovação do Lorenzo.

## Intenção

Em 17 dias de bot, nenhuma venda. Os dois leads que chegaram perto esfriaram enquanto esperavam o Lorenzo: a Novo Visual ficou 4 dias sem follow-up depois da prévia e fechou com outra empresa. O Lorenzo tem pouco tempo e quer que o bot faça o funil inteiro, entrando só para fechar.

Hoje, quando o lead pede a prévia, o bot pausa e tudo depende do Lorenzo: buscar fotos no Instagram, abrir o pedido no app, aprovar o envio e conduzir a conversa depois. A meta é que só uma coisa dependa dele antes do fechamento: **um toque para aprovar o PDF**.

Sucesso: o lead diz "quero a prévia" às 10h. Por volta das 10h15, o Lorenzo recebe no WhatsApp "Prévia de X pronta", abre o app, olha e toca em **Aprovar**. O PDF chega ao lead e o bot responde as dúvidas dele (preço, prazo, pagamento). O Lorenzo só volta a ser chamado quando o lead aceitar, pedir ajuste ou travar.

## Objetivos

- O pedido de prévia abre sozinho quando a conversa pausa com `preview_requested`, sem o Lorenzo fazer nada.
- O agente que já existe monta a prévia **sem fotos enviadas pelo Lorenzo**. Ele usa a foto de perfil do WhatsApp do lead (quando houver) e os dados que o Captação tem: nome, ramo, endereço e cidade.
- Quando o PDF estiver pronto para envio, o Lorenzo recebe um aviso no WhatsApp, pelo `notify` do bot.
- Depois do envio, a conversa **volta para o bot**, em vez de ficar pausada.

## Não objetivos

- Buscar fotos no Instagram ou no Facebook: os dois exigem login, e conta logada corre risco de ban.
- Notificação nativa no app Android. O aviso pelo WhatsApp já resolve.
- O bot negociar desconto ou fechar a venda. Aceite, desconto insistente e pedido de ajuste continuam indo para o Lorenzo, como hoje.

## Antiobjetivos: falhou, mesmo que funcione, se...

- **Um PDF chegar ao lead sem o toque de aprovação do Lorenzo.** Decidido por ele em 22/11 (opção A).
- Dois pedidos para o mesmo lead, ou a prévia de um lead chegar a outro.
- A prévia inventar fotos, preços, depoimentos ou endereço.
- Surgir qualquer custo novo.

## Restrições

- Captação em Docker, `/srv/captacao`. O `jarvis-previas` roda no host como serviço systemd, escuta só em 127.0.0.1:8095 e fala com o Captação pelo nginx, com o login do site (`createCaptacao`). O Captação não alcança o `jarvis-previas`, então **é o `jarvis-previas` que busca os pedidos no Captação**.
- Os agentes usam a assinatura do Claude do Lorenzo, no máximo 2 sessões ao mesmo tempo (`createRunner({ max: 2 })`).
- O Evolution só é chamado de dentro do Captação, nunca de fora.
- O agente não tem internet. Tudo o que ele usa precisa estar na pasta do pedido.

## Abordagens consideradas

1. **O `jarvis-previas` abre os pedidos sozinho e usa o agente atual (escolhida pelo Lorenzo).** Mantém a qualidade da prévia e reaproveita a aprovação e o envio que já funcionam. Custo: alguns minutos por prévia e uso da assinatura.
2. Prévia instantânea com o modelo fixo do Captação (`server/src/preview/`) convertido em PDF. Sai em segundos, mas o próprio design do Jarvis de prévias já descartou esse modelo por parecer genérico.
3. As duas: rascunho instantâneo primeiro e o PDF bom depois. São duas mensagens e duas aprovações, e o lead vê primeiro a versão pior.

## Como funciona

```
Lead: "quero a prévia" ──► bot pausa (preview_requested)   [já existe]
jarvis-previas (a cada tick do runner)
  └─ acha conversa preview_requested sem pedido ──► cria pedido automático
       ├─ lead.json: nome, telefone, ramo, endereço, cidade
       ├─ fotos/: foto de perfil do WhatsApp (se houver)
       └─ na_fila ──► agente monta site + PDF                 [já existe]
agente pede enviar-previa ──► aguardandoAprovacao = true     [já existe]
  └─ jarvis-previas avisa o Captação ──► notify no WhatsApp do Lorenzo  [novo]
Lorenzo toca Aprovar no app ──► PDF vai ao lead               [já existe]
  └─ Captação devolve a conversa ao bot (paused → active)    [novo]
Bot responde dúvidas; aceite/desconto/ajuste ──► pausa e chama Lorenzo [já existe]
```

### 1. Captação

- **Foto de perfil:** `GET /api/bot/conversations/:leadId/photo` pede ao Evolution a URL da foto de perfil do número (`/chat/fetchProfilePictureUrl/{instance}`), baixa a imagem e a devolve (JPEG/PNG, com limite de tamanho). Sem foto, ou com perfil privado, responde 404.
- **Dados do lead:** a lista de conversas (ou uma rota do lead) passa a trazer `niche`, endereço e cidade, que vêm da tabela `leads` ou da busca de origem.
- **Aviso de prévia pronta:** `POST /api/bot/conversations/:leadId/preview-ready` chama `notify("Prévia de <nome> pronta. Aprove no app Jarvis.")`. Só vale para conversas em `PREVIEW_OK`.
- **Depois do envio:** a rota `/preview` passa a mover a conversa de `paused` para `active` quando a pausa era `preview_requested`. Isso reverte uma decisão de 14/11 ("a conversa fica pausada após a prévia"), porque agora o Lorenzo quer o bot conduzindo. Se a pausa tiver outro motivo (por exemplo, o Lorenzo respondeu pelo celular), a conversa continua pausada.

### 2. jarvis-previas

- No `tick` do runner, antes de montar a fila: para cada lead com `pediuPrevia` que **não tem pedido em aberto nem pedido enviado nos últimos 30 dias**:
  - cria o pedido com `automatico: true`;
  - grava o `lead.json` com os campos novos e uma `observacao` padrão ("Pedido automático: sem fotos do Lorenzo");
  - baixa a foto de perfil para `fotos/01.jpg` quando ela existir;
  - coloca o pedido `na_fila`.

  Um pedido sem nenhuma foto também pode ir para a fila, mas só quando for automático. A rota `iniciar` continua exigindo foto nos pedidos manuais.
- Quando `aguardandoAprovacao` passar de `false` para `true` num pedido, o `jarvis-previas` chama o `preview-ready` uma única vez por pedido (guardar `avisadoEm`).
- Se o Lorenzo já abriu um pedido manual para o lead, o automático não é criado.

### 3. O agente (`agent/CLAUDE.md`)

- Nova seção "Pedido sem fotos ou só com a logo": compor um site tipográfico com cor e forma, usando a foto de perfil como logo quando ela parecer uma logo. **Nunca** usar imagens de banco nem inventar fotos. Usar ramo, endereço e cidade do `lead.json` só onde houver dado.
- As regras de envio não mudam: `enviar-previa` sozinho, com aprovação.

### 4. App Jarvis

- Nada obrigatório: o cartão do pedido já mostra **Aprovar** e **Recusar**. Se der pouco trabalho, marcar os pedidos automáticos com um selo "automático".

## Decidido pelo Lorenzo

- O funil todo é automático, com aprovação de 1 toque do PDF (22/11, opção A).
- Construir pela abordagem 1 (22/11).

## Escolhas minhas (para conferir)

- Aviso pelo WhatsApp, e não notificação no app, porque o app não tem notificações e o `notify` já existe.
- Não reabrir pedido para um lead que já recebeu prévia nos últimos 30 dias.
- Prévia sem fotos é aceita no pedido automático. A alternativa seria esperar o Lorenzo mandar fotos, mas aí o lead esfria, que é justamente o problema.
- Depois do envio, a conversa só volta para o bot quando a pausa era `preview_requested`.

## Fica a cargo do builder

- O formato exato das rotas novas e onde buscar o endereço (`leads` ou `searches`).
- Como reconhecer "esta foto parece uma logo" (ou deixar essa decisão para o agente).
- Testes: criação automática idempotente, aviso enviado uma vez só, conversa reativada só no caso `preview_requested`, foto 404 tratada.

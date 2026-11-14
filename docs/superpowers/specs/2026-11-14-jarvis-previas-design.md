# Jarvis de prévias: APK + agentes do Claude Code + Habblaud

Data: 2026-11-14 · Status: rascunho para aprovação do Lorenzo

## Por que existe

Quando um lead diz "sim" à prévia, o bot do Captação pausa a conversa e avisa o Lorenzo ("quer a prévia do site: monte com as fotos e informações dele e mande por aqui"). Hoje a prévia passa por estes passos:

1. Lorenzo pega as fotos do negócio no Instagram, pelo celular.
2. Manda as fotos para o próprio WhatsApp e as abre no Mac da empresa.
3. Uma conversa do Claude Code dedicada a sites gera o site e um PDF.
4. O PDF vai para um grupo no WhatsApp. Lorenzo baixa e encaminha ao lead.

São quatro passagens. Uma delas depende de estar no Mac da empresa, e o lead esfria a cada minuto. O objetivo é fazer tudo **pelo celular, no meio da conversa**: Lorenzo manda as fotos, um agente monta a prévia, Lorenzo confere e aprova, e o PDF sai **direto para o lead** pelo número do bot.

A prévia automática que o Captação já gera (`server/src/preview/preview.js`, modelo fixo por ramo) não serve, porque falta a qualidade que vem de fotos e dados reais. O padrão de qualidade é o que o Claude Code do Mac entrega hoje.

## Objetivos

- Do celular, mandar fotos (pela galeria ou pelo "Compartilhar" do Android) e escolher o lead em menos de 30 segundos.
- Um agente do Claude Code por pedido, no servidor, que monta o site (HTML) e o PDF.
- Acompanhar o agente no **Habblaud** pelo celular, pedir ajustes por mensagem e **aprovar o envio**.
- Com a aprovação, o PDF chega ao lead na conversa do bot e fica registrado no Captação como mensagem enviada.

## Fora do escopo (por enquanto)

- O agente buscar as fotos no Instagram sozinho. Fica para uma fase 2: o Instagram bloqueia acesso sem login, e uma conta logada corre risco de ban.
- O Jarvis de voz com persona de mordomo (o antigo OpenJarvis). É um projeto separado.
- iPhone. O APK é só para Android.

## Antiobjetivos: falhou, mesmo que funcione, se...

- **Algo chegar ao lead sem a aprovação explícita do Lorenzo.** É a regra mais importante do projeto, porque o número já foi banido antes e o bot nunca pode errar a oferta.
- Dados ou fotos de um lead aparecerem na prévia de outro.
- Houver qualquer custo novo, nem centavos ([[sem-servicos-pagos]]).
- O Habblaud, o terminal dos agentes ou o envio de fotos ficarem acessíveis fora do Tailscale. O Funnel público continua servindo só as prévias (porta 8091).

## Restrições

- Tudo roda no servidor Debian (`ssh servidor`, `/srv`), com o Captação em `/srv/captacao` (Docker Compose) e o Tailscale `servidor.tail1458e4.ts.net`.
- O Claude Code no servidor usa a assinatura do Lorenzo e gasta o mesmo limite de 5 horas e semanal. O Habblaud mostra esse uso.
- O celular é Android e acessa o servidor pelo app do Tailscale.
- O APK segue o modelo de `~/Documentos/app/vigia-android`: Java, sem Gradle, com `build.sh` (aapt2 → javac → d8 → apksigner) e Android SDK 35 em `~/Android/Sdk` no notebook.
- O envio pelo WhatsApp passa pelo Captação, que tem o Evolution, o modo `live` ou simulação (`isLive()`) e o registro em `bot_messages`. Nunca chamar o Evolution direto de fora do Captação.

## Abordagens consideradas

| | Como | Prós | Contras |
|---|---|---|---|
| A. Um agente fixo | Uma sessão do Claude Code sempre aberta recebe todos os pedidos. | Igual ao fluxo do Mac e conversável. | Atende um pedido por vez. O contexto acumula e mistura leads. |
| B. Execução automática por pedido | `claude -p` por pedido, com aprovação num botão do APK. | Mais simples e mais robusto. | O Habblaud vira só vitrine. Ajuste vira "refazer". |
| **C. Agente novo por pedido, aprovado no Habblaud** | Cada pedido abre uma sessão interativa própria, que pede permissão para enviar. | Cada lead isolado, conversável, e a aprovação é a "mão levantada" do Habblaud. | Mais peças. Pedidos em paralelo gastam o limite mais rápido. |

**Escolhida: C** (Lorenzo, 2026-11-14). É a que usa o Habblaud como ele imaginou, como a tela onde o trabalho acontece e é aprovado, sem misturar leads.

## Como funciona

```
Celular (APK)                     Servidor
─────────────                     ────────
Compartilhar fotos ──► jarvis-previas (host)   ── cria /srv/jarvis-previas/jobs/<id>/
escolher lead            │                          fotos + lead.json + CLAUDE.md
                         └─► tmux: claude (sessão interativa no diretório do pedido)
                                   │ monta site.html → previa.pdf
                                   │ pede permissão: enviar-previa <id>   ◄── "mão levantada"
Aba "Escritório" ◄── Habblaud ◄────┘                                         no Habblaud
(WebView)           aprova pelo celular ──► enviar-previa ──► API do Captação
                                                              └─► Evolution ──► lead
```

### 1. Serviço `jarvis-previas` (novo, no host)

- É um processo Node pequeno, que roda como serviço systemd do usuário `lorenzo`. Não fica em Docker, porque precisa abrir sessões do `claude` e do `tmux` no host.
- Escuta só no IP do Tailscale do servidor e em localhost. Toda chamada exige um token (`Authorization: Bearer`), guardado no APK.
- Endpoints:
  - `GET /leads`: **só leads que já têm conversa com o bot** e que não estão em opt-out nem encerrados. Os que pediram prévia (`paused` com motivo `preview_requested`) aparecem no topo, e há busca por nome entre eles. Lê pela API do Captação. Decisão do Lorenzo: mandar PDF a quem nunca falou com o bot é risco de ban.
  - `POST /pedidos`: recebe `leadId`, fotos (multipart) e uma observação opcional. Cria o diretório do pedido e abre a sessão.
  - `GET /pedidos`: lista os pedidos e o estado de cada um, para o APK mostrar.
  - `GET /pedidos/<id>/previa.pdf`: serve o PDF ao APK pelo Tailscale, para o Lorenzo **ver o que vai aprovar**. Nada fica público antes do envio.
- Ao criar um pedido:
  1. Gera `/srv/jarvis-previas/jobs/<id>/` com `fotos/`, `lead.json` (nome, ramo, cidade, telefone, endereço e o que o Captação souber), a observação e um `CLAUDE.md` com as instruções do agente (ver abaixo).
  2. Abre `tmux new-session -d -s previa-<id>` rodando `claude` nesse diretório, com a primeira mensagem já dada ("Monte a prévia deste pedido").
- Roda no máximo 2 pedidos ao mesmo tempo. Os demais esperam na fila.
- Depois do envio ou do cancelamento, fecha a sessão. O diretório fica guardado por 30 dias.

### 2. O agente (Claude Code por pedido)

- O `CLAUDE.md` do pedido diz:
  - quem é o cliente;
  - que o site é **uma página só**, em português, usando **as fotos do pedido** e os dados do `lead.json`, sem inventar preços, prêmios ou depoimentos;
  - o padrão visual e os textos de referência do Lorenzo. O builder pede ao Lorenzo a conversa ou os exemplos que o Claude do Mac usa e os transforma no guia.
- Ele gera `site.html` e `previa.pdf`. O PDF sai do HTML pelo Chromium sem tela que já existe no servidor (Playwright ou `chromium --headless --print-to-pdf`, à escolha do builder).
- **O envio é o único passo que pede permissão.** As permissões do Claude Code no diretório do pedido liberam escrever arquivos e rodar o gerador de PDF, e deixam `Bash(enviar-previa:*)` como `ask`. Quando o agente chama `enviar-previa <id>`, a sessão para, o personagem levanta a mão no Habblaud, e só a aprovação do Lorenzo deixa o comando rodar.
- O agente não tem acesso de rede além do necessário, nem à pasta do Captação, nem a chaves. As permissões negam `curl` e `ssh` genéricos e a leitura de `/srv/captacao/.env`.

### 3. Envio ao lead (mudança no Captação)

- Novo endpoint `POST /api/bot/conversations/:leadId/preview`, que recebe o PDF e uma legenda curta:
  - envia o documento pelo Evolution (`/message/sendMedia`), respeitando `isLive()`: em simulação, não sai nada;
  - grava em `bot_messages` (`direction: 'out'`, `source: 'lorenzo'` ou equivalente) e avisa o Lorenzo pelo `notify` ("Prévia enviada para X");
  - **deixa a conversa pausada**, porque depois da prévia quem continua é o Lorenzo (confirmado por ele);
  - **recusa** lead sem conversa com o bot, em opt-out ou encerrado. É a mesma regra do `GET /leads`, validada também aqui.
- `enviar-previa <id>` é um script pequeno que lê o `lead.json` e o `previa.pdf` do pedido e chama esse endpoint. O agente não recebe a credencial: o script a lê de um arquivo que o agente não pode ler.
- A legenda é um texto fixo, aprovado pelo Lorenzo, e não é gerada pela IA: "Aqui está a prévia que montei para vocês. É um rascunho: no site final eu ajusto textos, fotos e cores do jeito que preferirem. O que acharam?"

### 4. Habblaud

- Roda **no host com Node**, como serviço systemd, a partir de `marmottajr/habblaud` (MIT), com o mod no Claude Code (`npm run mod:install`). Não fica em Docker: o README exige um bridge no host para mandar mensagens a sessões fora do container, e as sessões rodam em tmux no host.
- O acesso remoto libera aprovar e mandar mensagens (`HABBLAUD_REMOTE_ALLOW=messages`). O terminal completo não é liberado no celular.
- Fica acessível só no Tailscale, com HTTPS via `tailscale serve` numa porta só da tailnet, por exemplo `https://servidor.tail1458e4.ts.net:4747`, sem Funnel.
- **Primeira tarefa do plano: um teste rápido** com uma sessão de mentira, para confirmar que, pelo celular via Tailscale, dá para aprovar uma permissão e mandar uma mensagem. O README diz que essas funções exigem o modo "Phone with login and HTTPS", e pode ser preciso ligar o login dele. **Se não funcionar**, o builder para e volta ao Lorenzo antes de seguir, porque a alternativa (aprovar no APK) é a abordagem B, que ele não escolheu.

### 5. APK "Jarvis"

- **Compartilhar → Jarvis:** recebe uma ou várias imagens (`ACTION_SEND` e `ACTION_SEND_MULTIPLE`, `image/*`) da galeria, do Instagram ou de prints.
- **Tela Novo pedido:**
  - as fotos recebidas, com opção de adicionar da galeria;
  - a lista de leads, com quem pediu prévia no topo e busca por nome;
  - uma observação opcional ("usar tons de verde");
  - o botão "Montar prévia".
- **Lista de pedidos:** o estado de cada pedido (na fila, montando, esperando aprovação, enviado) e o botão **"Ver prévia"**, que abre o PDF.
- **Aba Escritório:** um WebView com o Habblaud. É onde Lorenzo acompanha, conversa e aprova.
- Na configuração inicial: endereço do servidor e token. Mostra um aviso claro quando o Tailscale do celular está desligado.
- Compilado no notebook com o mesmo `build.sh` do vigia e instalado manualmente (sideload).

## Decidido por Lorenzo

- Fluxo C: um agente por pedido, aprovado no Habblaud.
- Depois da aprovação, o PDF vai **direto para o lead**, pelo número do bot.
- APK Android como porta de entrada das fotos e janela para o Habblaud.
- Fase 1: fotos mandadas pelo Lorenzo. Busca automática no Instagram fica para depois.

- Só leads com conversa com o bot, que não estejam em opt-out nem encerrados, podem receber prévia.
- O Claude Code no servidor usa **a conta pessoal do Lorenzo**, não a da empresa.
- A legenda fixa (seção 3) foi aprovada, e a conversa continua pausada depois do envio.
- Teste de ponta a ponta: **o número do próprio Lorenzo cadastrado como lead de teste**, com envio real autorizado. Nenhum lead real recebe nada durante os testes.

## Pendente

- **Material de referência do Claude do Mac:** as instruções daquela conversa e 2 ou 3 PDFs já enviados a leads. Sem isso, a etapa do `CLAUDE.md` do agente fica bloqueada.

## Escolhas minhas (para conferir)

- O Habblaud roda no host, e não em Docker. O APK mostra a prévia pelo `jarvis-previas`, sem expor nada antes da aprovação.
- Pasta e serviço com o nome `jarvis-previas`, para não colidir com o Jarvis de voz que será refeito depois.

- O serviço `jarvis-previas` roda no host com systemd, e não em Docker.
- No máximo 2 pedidos em paralelo. Diretórios guardados por 30 dias.
- O envio passa por um endpoint novo do Captação, e não pelo Evolution direto.

## Fica a cargo do builder

- A linguagem e o formato do `jarvis-previas`, mas sem novas dependências pagas.
- Como gerar o PDF.
- A estrutura interna do APK, os ícones e as telas.
- Como guardar o token no servidor e no APK.
- A forma exata de abrir a sessão interativa do `claude` com a primeira mensagem.

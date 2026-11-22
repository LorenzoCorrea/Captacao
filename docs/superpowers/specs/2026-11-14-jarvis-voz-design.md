# Jarvis de voz no app Jarvis: design

Data: 14/11/2026. Status: aguardando aprovação do Lorenzo.

## Intenção

O Lorenzo tinha dois "Jarvis": o de voz (OpenJarvis no Zima, só conversa, lento) e o de prévias (app no celular + agentes no servidor). O Zima foi desligado hoje e o de voz saiu do ar. Ele quer **um só Jarvis**: o mesmo app, com uma aba para falar com o mordomo, que **age nos sistemas dele** (Captação, prévias, servidor), consultando livremente e **pedindo aprovação antes de qualquer ação**.

Sucesso: no celular, ele aperta um botão, pergunta "algum lead respondeu hoje?" e ouve a resposta na voz do mordomo em poucos segundos; pede "pausa a conversa da Barbearia Davi", o Jarvis pede aprovação, ele aprova e ouve a confirmação.

## Objetivos

- Aba **Jarvis** no app atual: botão de falar, conversa em texto na tela e resposta falada com a voz de mordomo (Kokoro `pm_alex`).
- Consultas sem aprovação: bot do WhatsApp, conversas, estatísticas, buscas, pedidos de prévia e saúde do servidor.
- Ações só com aprovação do Lorenzo, pelo mesmo caminho das prévias (mão levantada no Habblaud, aprovação no Escritório).
- Persona do Jarvis antigo: mordomo britânico em PT-BR, trata por "senhor", respostas curtas faladas e nunca inventa dados.

## Não objetivos (por agora)

- Montar prévia por voz (precisa de fotos; continua pelo Novo pedido).
- Mandar mensagem livre para lead pelo WhatsApp.
- Shell livre, mudanças de código, webcam e faturas (ideias antigas, ficam para depois).
- Palavra de ativação ("Ei, Jarvis") com o app fechado.

## Anti-objetivos

- O Jarvis agir sem aprovação: qualquer coisa que mude dado, mande mensagem ou reinicie serviço precisa do "sim" do Lorenzo, sempre.
- O Jarvis ver senhas e tokens: as credenciais ficam com o usuário `lorenzo`, como no `enviar-previa`.
- Inventar números: se a ferramenta falhou, ele diz que não conseguiu.
- Qualquer custo: nada pago.

## Restrições

- Servidor Debian 16 GB, sem GPU; Claude Code com a assinatura do Lorenzo (sem custo extra).
- `/etc/claude-code/managed-settings.json` vale para todos os usuários do servidor (inclusive o agente das prévias): as regras novas não podem dar ao agente das prévias acesso às ferramentas do Jarvis.
- Acesso só pela tailnet, com o mesmo token do app.
- Antiga regra do bot: ele nunca nega ser automatizado; ampliar envios só com autorização do Lorenzo.

## Abordagens consideradas

- **A. Claude Code como cérebro (escolhida pelo Lorenzo).** Uma sessão do Claude Code no servidor, com ferramentas em scripts; consultas liberadas, ações com `ask`. Reaproveita o sandbox, o Habblaud e a aprovação já testada. Custo: 5 a 10 s por resposta e consumo do limite da assinatura.
- B. Gemini grátis com chamada de funções: mais rápido, mas cota diária, sistema de aprovação novo e, no plano grátis, o Google pode usar os dados (nomes e telefones de leads) para treino.
- C. Modelo local: fraco em ferramentas e lento na CPU. Descartado.

## Como funciona

```
App (aba Jarvis)                         Servidor
 botão falar ──► reconhecimento de voz do Android (pt-BR, no celular)
 texto ─────────► POST /jarvis/mensagens (jarvis-previas, mesmo token)
                    └─► sessão "jarvis" do Claude Code (tmux, usuário mordomo)
                          ├─ consultar-*  (liberado)  ─┐
                          └─ agir-*       (ask → Habblaud → Lorenzo aprova)
                                                       └─► sudo -u lorenzo ► Captação / jarvis-previas / systemctl
                    resposta em texto ◄─ hook Stop grava a última fala
                    └─► Kokoro (127.0.0.1, voz pm_alex) ► áudio
 toca o áudio e mostra o texto ◄── GET /jarvis/mensagens/:id (texto + áudio)
```

### Partes

1. **Usuário `mordomo`** (novo, sem sudo além do previsto): roda a sessão do Claude Code do Jarvis em `/srv/jarvis-voz/sessao`, com `CLAUDE.md` próprio (persona + ferramentas). Separado do `previas`, para um agente não alcançar as ferramentas do outro.
2. **Ferramentas** em `/srv/jarvis-voz/bin/`, donas `root:mordomo`, modo `750` (o `previas` não executa). Cada uma faz `sudo -n -u lorenzo` num script que tem as credenciais, como o `enviar-previa`. Ficam fora do sandbox (`excludedCommands`), porque precisam falar com o Captação em localhost.
   - Consultas (`allow`): `consultar-bot` (conectado, enviados hoje e limite), `consultar-conversas [status]`, `consultar-conversa <lead>`, `consultar-hoje` (`/api/today` e `/api/stats`), `consultar-buscas`, `consultar-pedidos` (prévias) e `consultar-servidor` (serviços, disco, memória, temperatura e containers).
   - Ações (`ask`): `agir-pausar <lead>`, `agir-retomar <lead>`, `agir-encerrar <lead> ganho|perdido`, `agir-bot ligar|desligar`, `agir-apagar-pedido <id>` e `agir-reiniciar <serviço>`, só para uma lista fixa (`jarvis-previas`, `habblaud` e os containers do Captação).
   - Os argumentos são validados no script do lado `lorenzo` (lead existente, id no formato certo, serviço na lista).
3. **Ponte de conversa** no `jarvis-previas` (mesmo serviço e token): `POST /jarvis/mensagens {texto}` manda o texto para a sessão (`tmux send-keys -l` + Enter) e devolve um id; `GET /jarvis/mensagens/:id` devolve `{estado, texto, audio?}`. A resposta vem de um hook `Stop` do Claude Code do `mordomo`, que grava a última fala do assistente num arquivo que a ponte lê. Uma mensagem por vez; enquanto o Jarvis pensa, o app mostra "pensando".
4. **Voz**: Kokoro (`pm_alex`) num serviço Python pequeno em `127.0.0.1`, que transforma o texto da resposta em áudio (OGG/Opus ou MP3). O `jarvis-previas` chama esse serviço e serve o áudio ao app. Se a voz falhar, o texto chega mesmo assim.
5. **App**: nova aba **Jarvis** (entre Pedidos e Escritório):
   - botão grande de falar (segurar ou tocar); usa o `SpeechRecognizer` do Android em pt-BR, com permissão de microfone;
   - histórico da conversa em balões;
   - campo de texto para digitar quando não der para falar;
   - toca a resposta falada;
   - quando a resposta pede aprovação, mostra o botão **Aprovar no Escritório**;
   - botão **Nova conversa**, que reinicia a sessão.
6. **Persona**: o `CLAUDE.md` do `mordomo` traz o `SOUL.md` e o `USER.md` do Jarvis antigo (no backup do Zima), mais as regras: respostas curtas para serem faladas (1 a 3 frases, sem markdown), use as ferramentas antes de afirmar qualquer número e, antes de uma ação, diga em uma frase o que vai fazer.

### Aprovação vista pelo app

A resposta só chega depois que a ação termina, e a ação espera a aprovação. Para o app não ficar em "pensando" sem explicação, a ponte olha a tela da sessão (`tmux capture-pane`) enquanto espera. Ao ver o pedido de permissão, devolve `estado: "aguardando_aprovacao"` com a linha da ação, e o app mostra o botão **Aprovar no Escritório**. A resposta falada vem depois da aprovação ou da recusa.

### Preparação do usuário `mordomo` (uma vez)

- O Lorenzo faz o login do Claude Code nele, com a conta dele, como fez no `previas`.
- `/srv/jarvis-voz/sessao` marcada como confiável no `~mordomo/.claude.json`.
- Mod do Habblaud (habblaud, permissões e mensagens) instalado para ele, para o personagem aparecer no Escritório e a aprovação ir ao celular. O Jarvis aparece com um nome próprio ("Jarvis") e fica separado dos agentes das prévias.
- Sudoers: `lorenzo ALL=(mordomo) NOPASSWD: /usr/bin/tmux` para a ponte comandar a sessão.

### Segurança

- O `mordomo` não tem internet (sandbox), não lê a config do `jarvis-previas` nem a pasta das prévias, e não roda `tmux`, `sudo` (exceto pelos scripts), `curl` nem `ssh`.
- O sudoers libera para o `mordomo` só os scripts do lado `lorenzo`, com argumentos validados no script.
- Servidores MCP continuam bloqueados (já é regra global).
- Toda ação aprovada fica registrada num log (`/srv/jarvis-voz/acoes.log`: data, ação, argumentos e resultado).

## Decisões que tomei (o Lorenzo pode mudar)

- A lista de ferramentas da v1 (acima).
- Usuário novo `mordomo` em vez de reaproveitar o `previas`.
- A ponte vive dentro do `jarvis-previas`, sem serviço novo para a API.
- O reconhecimento de voz é feito no celular pelo Android; a voz da resposta é feita no servidor pelo Kokoro.
- Uma sessão contínua, com botão "Nova conversa"; a sessão também recomeça sozinha depois de 6 h sem uso.
- Meta de tempo: até 15 s entre terminar de falar e começar a ouvir a resposta.

## Para o construtor decidir

- Formato do áudio e se o Kokoro roda com PyTorch ou ONNX (o que for mais rápido na CPU do servidor).
- Como o hook `Stop` identifica a resposta de cada mensagem (id no arquivo ou ordem).
- Detalhes visuais da aba, seguindo o visual novo do app.

## Riscos a conferir primeiro (spike)

1. O hook `Stop` e a aprovação pelo Habblaud funcionam juntos numa sessão comandada por `send-keys`.
2. Tempo do Kokoro na CPU do servidor para 1 a 3 frases.
3. O `SpeechRecognizer` funciona no S25 dentro do app sem os serviços do Google bloqueados.

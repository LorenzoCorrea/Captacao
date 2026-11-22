# Jarvis de voz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba Jarvis no app: o Lorenzo fala, o mordomo (Claude Code no servidor) consulta os sistemas livremente, age só com aprovação e responde com a voz Kokoro `pm_alex`.

**Architecture:** Uma sessão contínua do Claude Code roda em tmux como o usuário novo `mordomo`, em `/srv/jarvis-voz/sessao`. Ela usa duas ferramentas: `consultar`, liberada, e `agir`, que pede aprovação pelo Habblaud. As duas passam por `sudo -u lorenzo` para um script que tem as credenciais e valida os argumentos. O `jarvis-previas` ganha a ponte `/jarvis/*`: ela digita a mensagem na sessão, lê a resposta que o hook `Stop` grava, transforma a resposta em áudio pelo serviço Kokoro local e devolve texto e áudio ao app.

**Tech Stack:** Node 24 (sem dependências, `node --test`), Claude Code 2.1.x, tmux, Python 3 com `kokoro` em venv, APK sem Gradle (Java + WebView), `SpeechRecognizer` e `MediaPlayer` do Android.

**Spec:** `docs/superpowers/specs/2026-11-14-jarvis-voz-design.md`

## Global Constraints

- Nada pago. Claude Code com a assinatura do Lorenzo; Kokoro e reconhecimento de voz grátis.
- Toda ação que muda dado, manda mensagem ou reinicia serviço passa pela regra `ask` (aprovação do Lorenzo no Habblaud). Consultas não pedem.
- O `mordomo` nunca vê credenciais: só `/srv/jarvis-previas/config/config.json` (dono lorenzo, modo 600) as tem.
- O `mordomo` não tem internet, não roda `sudo`, `tmux`, `curl`, `ssh` nem servidores MCP; o agente das prévias (`previas`) não consegue executar as ferramentas do Jarvis.
- Respostas faladas de 1 a 3 frases, sem markdown, em PT-BR, tratando o Lorenzo por "senhor"; nunca afirmar número sem consultar.
- Serviços reiniciáveis, e só esses: `jarvis-previas`, `habblaud`, `captacao-web-1`, `captacao-api-1`, `captacao-evolution-1`, `captacao-router9-1`, `captacao-searxng-1`.
- Meta: no máximo 15 s entre o fim da fala e o começo do áudio.
- Toda ação aprovada vai para `/srv/jarvis-voz/acoes.log` (uma linha JSON: `em`, `acao`, `args`, `ok`, `saida`).
- Commits locais, sem push.

## Review Focus

- Mensagem nova enquanto o Jarvis ainda responde a anterior: o app recebe 409 "O Jarvis ainda está respondendo." e nada é digitado na sessão. Teste na Task 4.
- Texto ditado com quebra de linha, aspas, `;` ou mais de 2000 caracteres: vai literal e numa linha só, cortado em 2000, sem dividir a mensagem. Teste na Task 4.
- `agir` com lead que não existe, serviço fora da lista ou ação desconhecida: erro claro e nenhuma chamada ao Captação nem ao `systemctl`. Testes na Task 3.
- Kokoro fora do ar ou lento: a resposta chega só em texto (`audio: false`) em vez de travar. Teste na Task 4.
- Sessão do `mordomo` morta (tmux caiu ou reiniciou): a próxima mensagem recria a sessão em vez de falhar. Teste na Task 4.

---

### Task 1: Spike: voz Kokoro no servidor

**Files:**
- Create: `jarvis-previas/voz/kokoro/servidor.py`
- Create: `jarvis-previas/voz/kokoro/requirements.txt`
- Create: `jarvis-previas/deploy/jarvis-kokoro.service`

**Interfaces:**
- Produces: HTTP em `127.0.0.1:8096`. `POST /falar` com JSON `{"texto": str}` devolve `200 audio/wav`, 24 kHz mono; `GET /saude` devolve `200 ok`.

- [ ] **Step 1: Instalar no servidor.** Criar o venv `/srv/jarvis-voz/kokoro/venv`, dono `lorenzo`, com `kokoro` e `soundfile` e com o `torch` só para CPU, pelo índice `https://download.pytorch.org/whl/cpu`. Baixar a voz `pm_alex` uma vez; o cache fica em `/srv/jarvis-voz/kokoro/cache`.
- [ ] **Step 2: Medir.** Gerar a frase "Boa tarde, senhor. Dois leads responderam hoje e um pedido aguarda sua aprovação." com `lang_code='p'` e `voice='pm_alex'`, cinco vezes, depois de aquecer.
  Expected: média abaixo de 5 s. Se passar de 5 s, registrar `Ruling:` no ledger e trocar para `kokoro-onnx` com o mesmo contrato HTTP.
- [ ] **Step 3: Implementar `servidor.py`** com `http.server`. O modelo é carregado uma vez na subida. Texto vazio ou com mais de 600 caracteres devolve `400`. Escuta só em `127.0.0.1:8096`.
- [ ] **Step 4: Unit `jarvis-kokoro.service`.** Usuário `lorenzo`, `Restart=always`, `MemoryMax=2G`.
- [ ] **Step 5: Verificar.**
  Run: `curl -s -o /tmp/t.wav -w '%{http_code} %{time_total}\n' -d '{"texto":"Às suas ordens, senhor."}' 127.0.0.1:8096/falar && file /tmp/t.wav`
  Expected: `200` em menos de 5 s e `RIFF (little-endian) data, WAVE audio`.
- [ ] **Step 6: Commit** (`feat(jarvis-voz): serviço de voz Kokoro`).

### Task 2: Spike: usuário mordomo, hook Stop e aprovação

**Files:**
- Create: `jarvis-previas/voz/hooks/ao-parar` (executável)
- Create: `jarvis-previas/voz/claude-settings.json` (vai para `~mordomo/.claude/settings.json`)
- Create: `jarvis-previas/voz/sessao/CLAUDE.md` (provisório nesta task)
- Create: `jarvis-previas/voz/install-voz.sh`
- Modify: `jarvis-previas/deploy/sudoers`

**Interfaces:**
- Produces: depois de cada resposta, `/srv/jarvis-voz/estado/resposta.json` contém `{"texto": str, "em": number(ms)}`. O arquivo é gravado de forma atômica (`.tmp` + `rename`), com dono `mordomo` e modo `644`.
- Produces: sessão tmux `jarvis` do usuário `mordomo`, com cwd `/srv/jarvis-voz/sessao`, comandada por `sudo -n -u mordomo -H tmux ...`.

- [ ] **Step 1: `install-voz.sh`** (idempotente, roda como root). Ele faz o seguinte:
  - cria o usuário `mordomo`, sem senha e com shell `/bin/bash`;
  - cria `/srv/jarvis-voz/{sessao,estado,bin,kokoro}` e `acoes.log`, com `estado` gravável pelo `mordomo` e `acoes.log` dono `lorenzo`;
  - instala o Claude Code para o `mordomo` pelo mesmo instalador usado no `previas`;
  - marca `/srv/jarvis-voz/sessao` como confiável no `~mordomo/.claude.json`;
  - instala o mod do Habblaud (`habblaud`, `habblaud-permissoes`, `habblaud-mensagens`), como no `previas`;
  - copia `claude-settings.json` e o hook.
- [ ] **Step 2: Hook `ao-parar`.** Lê o JSON do hook pela entrada padrão, pega o último texto do assistente no `transcript_path` e grava `resposta.json`. Usa `last_assistant_message` quando esse campo existir na entrada.
- [ ] **Step 3: Sudoers.** Adicionar `lorenzo ALL=(mordomo) NOPASSWD: /usr/bin/tmux` e conferir com `visudo -cf`.
- [ ] **Step 4: Passo humano.** O Lorenzo faz o login do Claude Code como `mordomo`: `sudo -u mordomo -H /home/mordomo/.local/bin/claude`, depois `/login` com a conta dele.
- [ ] **Step 5: Verificar o hook.**
  Run:
  ```
  sudo -n -u mordomo -H tmux new-session -d -s jarvis -c /srv/jarvis-voz/sessao /home/mordomo/.local/bin/claude
  sudo -n -u mordomo -H tmux send-keys -t jarvis -l 'Responda só: pronto'
  sudo -n -u mordomo -H tmux send-keys -t jarvis Enter
  ```
  Esperar 20 s e ler `resposta.json`.
  Expected: `texto` contém "pronto" e `em` é de agora.
- [ ] **Step 6: Verificar a aprovação e o bloqueio do sudo.**
  - Com uma regra `ask` provisória para `Bash(/srv/jarvis-voz/bin/agir:*)` (um `agir` que só faz `echo ok`), pedir: "rode /srv/jarvis-voz/bin/agir teste".
    Expected: aparece no Habblaud o pedido de aprovação; depois de aprovado, `resposta.json` traz a resposta.
  - Pedir: "rode sudo -n true".
    Expected: negado pela regra ou falha dentro do sandbox. Registrar no ledger qual dos dois aconteceu.
- [ ] **Step 7: Commit** (`feat(jarvis-voz): usuário mordomo, hook de resposta e aprovação`).

### Task 3: Ferramentas consultar e agir

**Files:**
- Create: `jarvis-previas/src/ferramentas.js`
- Modify: `jarvis-previas/src/captacao.js` (adiciona `api`)
- Create: `jarvis-previas/bin/jarvis-lorenzo` (node, executável)
- Create: `jarvis-previas/voz/bin/consultar` e `jarvis-previas/voz/bin/agir` (sh)
- Modify: `jarvis-previas/deploy/sudoers` e `jarvis-previas/deploy/managed-settings.json`
- Test: `jarvis-previas/test/ferramentas.test.js`

**Interfaces:**
- Consumes: `createCaptacao({url, auth, fetch})` de `src/captacao.js` e `createStore` de `src/store.js`.
- Produces: `captacao.api(method: string, path: string, body?: object) -> Promise<any>`. Lança `Error` com a mensagem do Captação quando a resposta não é 2xx.
- Produces: `createFerramentas({ captacao, store, sistema, log }) -> { consultar(assunto: string, args: string[]) -> Promise<string>, agir(acao: string, args: string[]) -> Promise<string> }`.
  - `sistema = { servicos() -> Promise<object>, reiniciar(nome) -> Promise<void> }`.
  - `log(linha: object)` só é chamado em `agir`.
  - O texto devolvido é curto e legível; a mesma string é o que o Claude lê.
- Produces: comandos do `mordomo`, `/srv/jarvis-voz/bin/consultar <assunto> [args]` e `/srv/jarvis-voz/bin/agir <acao> [args]`. Cada um faz `exec sudo -n -u lorenzo /srv/jarvis-previas/app/bin/jarvis-lorenzo consultar|agir "$@"`.

Assuntos de `consultar`:
- `bot`: `GET /api/bot/status`;
- `conversas [status]`: `GET /api/bot/conversations`, filtrado pelo status e devolvendo `nome · lead_id · status · motivo`;
- `conversa <leadId>`: `GET /api/bot/conversations/:id` com as 5 últimas mensagens;
- `hoje`: `GET /api/today` e `GET /api/stats`;
- `buscas`: `GET /api/searches`, as 5 mais recentes;
- `pedidos`: o `store.list()` das prévias;
- `servidor`: `sistema.servicos()`.

Ações de `agir`:
- `pausar <leadId>`: `POST /api/bot/conversations/:id/pause`;
- `retomar <leadId>`: `POST .../resume`;
- `encerrar <leadId> ganho|perdido`: `POST .../finish` com `{won}`;
- `bot ligar|desligar`: `PUT /api/bot/enabled` com `{enabled}`;
- `apagar-pedido <id>`: valida o id com `/^[a-z0-9]{8}$/` e chama `POST http://127.0.0.1:8095/pedidos/:id/apagar` com o token da config;
- `reiniciar <serviço>`: `sistema.reiniciar`, só para a lista do Global Constraints.

- [ ] **Step 1: Escrever os testes que falham**, com `captacao`, `store`, `sistema` e `log` falsos que registram as chamadas:
  - `consultar conversas paused` lista só as pausadas, com `lead_id`;
  - `consultar xyz` lança `Assunto desconhecido: xyz`;
  - `agir pausar osm:node/1` chama `POST /api/bot/conversations/osm%3Anode%2F1/pause` e grava `log` com `ok: true`;
  - `agir pausar` com lead que não está em `GET /api/bot/conversations` lança `Lead não encontrado` e não faz POST;
  - `agir reiniciar postgres-db` lança `Serviço fora da lista` e não chama `sistema.reiniciar`;
  - `agir encerrar <lead> talvez` lança `Use ganho ou perdido`;
  - `agir apagar-pedido ../x` lança `Pedido inválido`;
  - uma falha do Captação vira `ok: false` no `log`, e o erro sobe com a mensagem dele.
- [ ] **Step 2: Rodar** `node --test test/ferramentas.test.js`. Expected: FAIL (`ferramentas.js` não existe).
- [ ] **Step 3: Implementar** `ferramentas.js` e `captacao.api`. No `bin/jarvis-lorenzo`:
  - lê a config como o `enviar-previa-lorenzo`;
  - `sistema.servicos` usa `systemctl is-active` e `docker ps --format`, `df -h /` e `free -m`;
  - `sistema.reiniciar` usa `systemctl restart` para as units, por uma regra de sudoers só para elas, e `docker restart` para os containers;
  - imprime o texto e sai com 1 em caso de erro.
- [ ] **Step 4: Rodar** `npm test`. Expected: todos passam.
- [ ] **Step 5: Permissões.** No `managed-settings.json`:
  - `allow`: `Bash(/srv/jarvis-voz/bin/consultar:*)`;
  - `ask`: `Bash(/srv/jarvis-voz/bin/agir:*)`;
  - `excludedCommands`: os dois caminhos;
  - `allow`: `Read(//srv/jarvis-voz/sessao/**)` e `Edit(//srv/jarvis-voz/sessao/**)`.

  Em `/srv/jarvis-voz/bin`: dono `root:mordomo`, modo `750`. No sudoers:
  - `mordomo ALL=(lorenzo) NOPASSWD: /srv/jarvis-previas/app/bin/jarvis-lorenzo consultar *, /srv/jarvis-previas/app/bin/jarvis-lorenzo agir *`;
  - `lorenzo ALL=(root) NOPASSWD: /usr/bin/systemctl restart jarvis-previas, /usr/bin/systemctl restart habblaud`.
- [ ] **Step 6: Verificar no servidor.**
  - `sudo -u previas /srv/jarvis-voz/bin/consultar bot`. Expected: `Permissão negada`.
  - `sudo -u mordomo /srv/jarvis-voz/bin/consultar bot`. Expected: o estado do bot.
- [ ] **Step 7: Commit** (`feat(jarvis-voz): ferramentas consultar e agir`).

### Task 4: Ponte da conversa no jarvis-previas

**Files:**
- Create: `jarvis-previas/src/conversa.js`
- Modify: `jarvis-previas/src/server.js` (rotas `/jarvis/*`)
- Modify: `jarvis-previas/src/main.js`
- Test: `jarvis-previas/test/conversa.test.js` e casos novos em `test/server.test.js`

**Interfaces:**
- Consumes: `resposta.json` da Task 2 e `POST 127.0.0.1:8096/falar` da Task 1.
- Produces: `createConversa({ tmux, respostaFile, falar, now = Date.now, esperaMax = 180000 })`, que retorna:
  - `enviar(texto: string) -> Promise<{id: string}>`;
  - `estado(id) -> Promise<{estado: 'pensando'|'aguardando_aprovacao'|'pronta'|'erro', texto?: string, acao?: string, audio: boolean}>`;
  - `audio(id) -> Buffer|undefined`;
  - `nova() -> Promise<void>`.
- `tmux = { vivo() -> Promise<bool>, iniciar() -> Promise<void>, digitar(texto) -> Promise<void>, tela() -> Promise<string>, matar() -> Promise<void> }`. A implementação real fica em `conversa.js`, como `tmuxDoMordomo()`, e usa `execFile('sudo', ['-n','-u','mordomo','-H','tmux', ...])`.
- `falar(texto) -> Promise<Buffer>` lança erro quando o Kokoro falha.
- Rotas (Bearer, como as outras):
  - `POST /jarvis/mensagens {texto}`: `201 {id}`, ou `409 {error:'O Jarvis ainda está respondendo.'}`;
  - `GET /jarvis/mensagens/:id`: o `estado`;
  - `GET /jarvis/mensagens/:id/audio`: `audio/wav`, ou 404;
  - `POST /jarvis/nova`: `200`.

Comportamento:
- `enviar` grava `enviadoEm = now()`. Se `!vivo()`, chama `iniciar()` e espera 8 s antes de digitar.
- `digitar` usa `send-keys -l` com o texto, mais `Enter`.
- `estado` faz o seguinte:
  - lê `resposta.json`; se `em > enviadoEm`, devolve `pronta` com o texto e chama `falar` uma vez, guardando o áudio só da última mensagem;
  - se `falar` falhar, devolve `pronta` com `audio: false`;
  - se a `tela()` contiver `Do you want to proceed`, devolve `aguardando_aprovacao`, com `acao` igual à primeira linha da tela que contém `/srv/jarvis-voz/bin/agir`;
  - depois de `esperaMax`, devolve `erro`.
- A sessão também recomeça (`nova()`) quando a última mensagem tem mais de 6 h.

- [ ] **Step 1: Escrever os testes que falham** (`conversa.test.js`, com `tmux`, `falar` e relógio falsos e um `respostaFile` temporário):
  - `enviar` com sessão morta chama `iniciar` antes de `digitar`;
  - um segundo `enviar` antes da resposta lança `ocupado`;
  - o texto `'a\nb "c"; d'` vira `'a b "c"; d'`, e um texto de 2500 caracteres chega com 2000;
  - com a resposta gravada depois do envio, `estado` dá `pronta`, `audio: true`, e `falar` é chamado uma vez em duas consultas;
  - `falar` lançando erro dá `pronta` com `audio: false`;
  - a tela com `Do you want to proceed` e `agir pausar osm:node/1` dá `aguardando_aprovacao` com essa ação;
  - passado `esperaMax`, dá `erro`;
  - última mensagem há mais de 6 h: o próximo `enviar` chama `matar` e `iniciar`.

  No `server.test.js`: `POST /jarvis/mensagens` sem token dá 401; com `texto` vazio dá 400; ocupado dá 409.
- [ ] **Step 2: Rodar** `npm test`. Expected: FAIL nos testes novos.
- [ ] **Step 3: Implementar** `conversa.js`, as rotas e a ligação no `main.js`. O `falar` real faz `fetch('http://127.0.0.1:8096/falar')` com `AbortSignal.timeout(20000)`.
- [ ] **Step 4: Rodar** `npm test`. Expected: todos passam.
- [ ] **Step 5: Verificar no servidor.** Instalar, reiniciar o `jarvis-previas` e fazer `POST /jarvis/mensagens {"texto":"como está o bot?"}`. Consultar o `GET` até `pronta`.
  Expected: texto em PT-BR citando o estado real do bot, áudio WAV tocável e menos de 15 s entre o envio e `pronta`.
- [ ] **Step 6: Commit** (`feat(jarvis-voz): ponte da conversa`).

### Task 5: Persona e instruções do mordomo

**Files:**
- Modify: `jarvis-previas/voz/sessao/CLAUDE.md`
- Modify: `jarvis-previas/voz/install-voz.sh` (copia o CLAUDE.md)

- [ ] **Step 1: Persona.** Extrair `SOUL.md` e `USER.md` de `/srv/backup-zima-2026-11-14/jarvis-vigia.tar.gz` (pasta `DATA/AppData/jarvis/data/`) e trazer para o `CLAUDE.md` o tom, o tratamento "senhor" e a regra de não inventar.
- [ ] **Step 2: Regras de voz e ferramentas.** O `CLAUDE.md` diz:
  - 1 a 3 frases, sem markdown, listas, emojis ou códigos;
  - números por extenso só quando forem curtos;
  - sempre `consultar` antes de afirmar algo sobre os sistemas;
  - para agir num lead citado pelo nome, `consultar conversas` primeiro para achar o `lead_id`; se houver dois parecidos, perguntar qual;
  - antes de `agir`, dizer em uma frase o que vai fazer;
  - se `agir` for recusado, aceitar sem insistir;
  - uma ferramenta por comando, sem `&&`, `;` nem `|`;
  - a lista completa de assuntos e ações da Task 3.
- [ ] **Step 3: Verificar.** Pela ponte, perguntar:
  - "quantas conversas estão pausadas?" Expected: número igual ao de `consultar conversas paused` e 3 frases ou menos;
  - "pausa a conversa da Barbearia Davi" com o Lorenzo recusando. Expected: `aguardando_aprovacao` e, depois da recusa, uma resposta curta sem nova tentativa.
- [ ] **Step 4: Commit** (`feat(jarvis-voz): persona do mordomo`).

### Task 6: Aba Jarvis no app

**Files:**
- Modify: `jarvis-android/AndroidManifest.xml` (`RECORD_AUDIO` e `<queries>` para `android.speech.RecognitionService`)
- Modify: `jarvis-android/src/app/jarvis/MainActivity.java`
- Modify: `jarvis-android/assets/app.html`

**Interfaces:**
- Consumes: as rotas `/jarvis/*` da Task 4.
- Produces, na ponte Java:
  - `ouvir(cb)`: pede a permissão de microfone se faltar e usa `SpeechRecognizer` com `EXTRA_LANGUAGE="pt-BR"`. Volta com o texto ou com o erro `Não entendi, tente de novo.`. Enquanto escuta, chama `window.onOuvindo(nivel)`.
  - `tocar(cb, id)`: baixa `/jarvis/mensagens/:id/audio` com o token e toca com `MediaPlayer`. Volta ao terminar.
  - `pararDeFalar()`.

- [ ] **Step 1: Spike do reconhecimento.** Gerar um APK só com o botão e o `ouvir`, instalar no S25 e ditar "quantos leads responderam hoje".
  Expected: o texto volta certo. Se não houver serviço de reconhecimento, registrar `Ruling:` e deixar só o campo de texto.
- [ ] **Step 2: Aba Jarvis**, entre Novo pedido e Escritório, no visual atual:
  - balões da conversa, numa lista guardada só na memória da tela;
  - botão grande de microfone, com o estado ouvindo, pensando ou falando;
  - campo de texto com enviar;
  - quando chega `aguardando_aprovacao`, o balão mostra a ação e o botão **Aprovar no Escritório** (`Jarvis.abrirEscritorio()`);
  - botão **Nova conversa** no cabeçalho, que chama `POST /jarvis/nova`;
  - a pergunta é feita a cada 1,5 s com `GET /jarvis/mensagens/:id` até `pronta` ou `erro`;
  - com `audio: true`, chama `tocar`;
  - o voltar do Android segue a regra atual (vai para Pedidos).
- [ ] **Step 3: Verificar no navegador** com o mock da sessão anterior, estendido para as rotas `/jarvis`.
  Expected: telas sem rolagem lateral em 412 px e os quatro estados visíveis.
- [ ] **Step 4: Gerar o APK, mandar pelo Taildrop e testar no S25.**
  Expected:
  - "como está o bot?" é respondido por voz em até 15 s;
  - "pausa a conversa de <lead de teste>" mostra Aprovar no Escritório, e aprovar faz a conversa aparecer pausada no painel;
  - "Nova conversa" zera os balões.
- [ ] **Step 5: Commit** (`feat(jarvis-android): aba Jarvis com voz`).

### Task 7: Instalação reproduzível e memória

**Files:**
- Modify: `jarvis-previas/deploy/install-remote.sh` (chama `voz/install-voz.sh` e instala `jarvis-kokoro.service`)
- Modify: memórias `captacao-infra-zima.md` e `jarvis-setup.md` (o Jarvis de voz agora roda no servidor) e o mapa da infra (artifact), que ganha o `mordomo` e o Kokoro.

- [ ] **Step 1:** Rodar `install-remote.sh` duas vezes seguidas. Expected: a segunda passa sem erro e sem mudar nada.
- [ ] **Step 2:** Reiniciar o servidor. Expected:
  - `jarvis-kokoro`, `jarvis-previas` e `habblaud` voltam ativos;
  - a primeira mensagem no app recria a sessão `jarvis` e responde.
- [ ] **Step 3:** Atualizar as memórias e o mapa e fazer o commit (`chore(jarvis-voz): instalação e documentação`).

---

## Emenda (14/11, aprovada pelo Lorenzo): aprovação direto no app

O Habblaud só repassa um pedido de aprovação se o Escritório estiver aberto no instante do pedido. Então a aprovação passa a ser feita pelo app, tanto no Jarvis quanto nas prévias:

- **Task 4:**
  - `conversa.responder(aprovar: boolean) -> Promise<void>`. Lê a tela da sessão e só age se ela contiver `Do you want to proceed?` e a mesma linha `/srv/jarvis-voz/bin/agir ...` informada em `estado().acao`. Aprovar digita `1`; recusar digita `Escape`. Se a tela mudou, lança `O pedido mudou; confira de novo.`
  - Rota `POST /jarvis/mensagens/:id/aprovacao {aprovar: boolean}`.
  - Testes: tela sem pedido → erro; ação diferente → erro, sem tecla; aprovar → `1`; recusar → `Escape`.
- **Task 4b (nova): aprovação das prévias.**
  - O `tmuxComoPrevias` ganha `tela(nome)` e `teclas(nome, ...teclas)`.
  - O `runner.tick` marca `aguardandoAprovacao: true` no pedido quando a tela da sessão pede permissão para `/srv/jarvis-previas/app/bin/enviar-previa`, e `false` no caso contrário.
  - Rota `POST /pedidos/:id/aprovacao {aprovar}` com a mesma conferência: só para `enviar-previa`.
  - Testes no `runner.test.js` e no `server.test.js`.
- **Task 6:** botões **Aprovar** e **Recusar** no balão do Jarvis e no cartão do pedido (no lugar de "Aprovar no Escritório").

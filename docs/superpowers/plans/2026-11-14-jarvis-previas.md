# Jarvis de prévias: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pelo celular, Lorenzo manda fotos de um lead. Um agente do Claude Code por pedido monta o site e o PDF no servidor. Lorenzo aprova pelo Habblaud e o PDF sai para o lead pelo número do bot.

**Architecture:** Um serviço Node sem dependências (`jarvis-previas`, systemd do usuário `lorenzo`) recebe os pedidos do APK e abre uma sessão `claude` em tmux para cada um. As sessões rodam com o usuário isolado `previas`. O único jeito de enviar é `sudo -u lorenzo enviar-previa <id>`, deixado como `ask` nas permissões do Claude Code, o que faz o personagem levantar a mão no Habblaud. O script chama um endpoint novo do Captação, que manda o PDF pelo Evolution.

**Tech Stack:** Node 24 (só `node:http`, `node:fs` e `node:test`), Claude Code, tmux, Chromium headless, Habblaud (host, Node), Captação (Express e Evolution), Android em Java sem Gradle (modelo `~/Documentos/app/vigia-android/build.sh`).

**Spec:** `docs/superpowers/specs/2026-11-14-jarvis-previas-design.md`

## Global Constraints

- Nada pago: sem APIs, sem hospedagem e sem dependências npm no `jarvis-previas`.
- Nada chega ao lead sem a aprovação explícita do Lorenzo. O envio é **sempre** um comando que pede permissão (`ask`) e nunca fica em `allow`.
- Pode receber prévia só quem tem conversa com o bot em `active`, `paused` ou `ready_to_close` e não está em opt-out. A regra vale no `GET /leads` **e** no endpoint do Captação.
- Legenda fixa: `Aqui está a prévia que montei para vocês. É um rascunho: no site final eu ajusto textos, fotos e cores do jeito que preferirem. O que acharam?`
- A conversa continua `paused` depois do envio.
- Habblaud, `jarvis-previas` e terminal ficam só no Tailscale. O Funnel continua servindo apenas a porta 8091.
- No máximo 2 pedidos rodando ao mesmo tempo. Diretórios apagados depois de 30 dias. Sessão morta depois de 6 h.
- Nomes: serviço e pasta `jarvis-previas`, base em `/srv/jarvis-previas`, sessões tmux `previa-<id>`, usuário Linux `previas`.
- Deploy do Captação conforme a memória: rsync para `servidor:/srv/captacao`, sem sobrescrever `.env` nem `.htpasswd`, e depois `docker compose up -d --build`. Commits locais, sem push.
- Testes de envio real: só para o **lead de teste com o número do Lorenzo** (`OWNER_WHATSAPP`), nunca para lead real.

## Review Focus

1. **PDF grande, acima de 1 MB:** o nginx recusa por padrão com 413. Fotos do Instagram geram PDFs de 2 a 8 MB, e o envio precisa passar. Teste na Task 3, com um PDF de 5 MB.
2. **Duas aprovações do mesmo pedido, ou o agente chamando `enviar-previa` de novo depois de um ajuste:** o segundo envio só pode sair se o PDF mudou. Um PDF idêntico é recusado com "já enviado". Teste na Task 7.
3. **`<id>` manipulado no `enviar-previa`** (`../`, outro pedido, ID de pedido já enviado): o script aceita só `^[a-z0-9]{8}$`, resolve o lead pelo registro do serviço e nunca por arquivo que o agente escreve. Teste na Task 7.
4. **O lead sai da conversa (opt-out ou encerrado) entre o pedido e a aprovação:** o Captação recusa com 409, e o pedido vira `erro` com mensagem clara no APK. Teste na Task 3.
5. **Fotos HEIC ou WebP vindas do Instagram ou da galeria, e foto acima de 15 MB:** são aceitas `image/jpeg`, `image/png` e `image/webp` até 15 MB. Os outros tipos recebem 415 com mensagem no APK. Teste na Task 5.

---

### Task 1: Teste rápido de infraestrutura (bloqueante)

Prova as três premissas antes de escrever qualquer código. **Se o item 4 falhar, pare e volte ao Lorenzo** (a spec manda assim).

**Files:**
- Modify: `docs/superpowers/specs/2026-11-14-jarvis-previas-design.md` (nova seção "Resultado do teste de infraestrutura")

- [ ] **Step 1: Preparar o servidor**
  - Instalar Node 24 pelo repositório NodeSource (`deb.nodesource.com/node_24.x`), mais `tmux` e `chromium`.
  - Criar o usuário `previas` sem sudo e fora do grupo docker, e a base `/srv/jarvis-previas/{app,data,jobs,config}` (dono `lorenzo`, `jobs` com grupo `previas` e modo 2775, `config` com modo 700).
  - Instalar o Claude Code para `previas` (`sudo -iu previas`, `curl -fsSL https://claude.ai/install.sh | bash`).

  Expected: `sudo -iu previas claude --version` imprime a versão. `node --version` imprime `v24.x`.
- [ ] **Step 2: Login do Claude (manual, Lorenzo)**
  Lorenzo roda `ssh -t servidor sudo -iu previas claude`, faz login com **a conta pessoal** e sai.
  Expected: `sudo -iu previas claude -p "diga ok"` responde.
- [ ] **Step 3: Confiança e permissões sem perguntas**
  - Escrever `~previas/.claude/settings.json` com as permissões:
    - `allow`: `Read`, `Write` e `Edit` em `/srv/jarvis-previas/jobs/**`, `Bash(chromium:*)` e `Bash(ls:*)`;
    - `ask`: `Bash(sudo -u lorenzo /srv/jarvis-previas/app/bin/enviar-previa:*)`;
    - `deny`: `Bash(curl:*)`, `Bash(wget:*)`, `Bash(ssh:*)` e `WebFetch`.
  - Escolher o `defaultMode` que **nega** em silêncio o que não está listado, em vez de perguntar.
  - Aceitar a confiança na pasta `/srv/jarvis-previas/jobs`.
  - Criar `jobs/teste1/` e rodar `tmux new -d -s previa-teste1 -c ... "claude 'crie oi.txt e depois rode sudo -u lorenzo /srv/jarvis-previas/app/bin/enviar-previa teste1'"` (o script pode ser `echo` por enquanto).

  Expected: a sessão **não** pede confiança na pasta nova. Ela escreve `oi.txt` sem perguntar e **para** pedindo permissão só no `enviar-previa`. Se a confiança for pedida, testar o pré-cadastro em `~previas/.claude.json` (`projects["<dir>"].hasTrustDialogAccepted=true`) feito pelo serviço antes de abrir a sessão, e registrar qual funcionou.
- [ ] **Step 4: Habblaud no celular**
  - Clonar `marmottajr/habblaud` em `/srv/habblaud` (dono `previas`) e rodar `npm install`, `npm run build` e `npm run mod:install`, como `previas`.
  - Subir com o login e o HTTPS do modo celular e `HABBLAUD_REMOTE_ALLOW=messages`, servindo em `127.0.0.1:4747`.
  - Publicar com `tailscale serve --bg --https=4747 http://127.0.0.1:4747`, sem Funnel.
  - Repetir o Step 3.

  Expected: no celular do Lorenzo, com o Tailscale ligado, `https://servidor.tail1458e4.ts.net:4747` mostra o personagem com a mão levantada. **Aprovar** pelo celular faz o comando rodar, e **mandar uma mensagem** pelo celular chega à sessão. Testar também dentro de um WebView: abrir a URL no app "Android System WebView Shell" ou num APK mínimo, porque login e cookies precisam funcionar ali.
- [ ] **Step 5: Registrar e commitar**
  - Anotar na spec o que funcionou: `defaultMode`, método de confiança, variáveis do Habblaud e se o WebView funciona.
  - Criar `jarvis-previas/deploy/habblaud.service` (systemd, `User=previas`) com o comando que funcionou.
  - Commitar: `git add docs/superpowers/specs/2026-11-14-jarvis-previas-design.md jarvis-previas/deploy/habblaud.service` e `git commit -m "docs: resultado do teste de infraestrutura do Jarvis de prévias"`.

---

### Task 2: Envio de documento pelo gateway

**Files:**
- Modify: `server/src/bot/gateway.js` (novo método `sendDocument`)
- Modify: `server/src/bot/engine.js:22-38` (`sendAndRecord` ganha a opção `send`)
- Test: `server/test/bot-engine.test.js`

**Interfaces:**
- Produces: `gateway.sendDocument(phone: string, { pdf: Buffer, fileName: string, caption: string }) -> Promise<string /* id da mensagem */>`
- Produces: `sendAndRecord(conv, text, deps, { allow, send })`. `send`, se presente, é `() => Promise<string>` e substitui `gateway.send(conv.phone, text)`. `text` continua sendo o corpo gravado em `bot_messages`.

- [ ] **Step 1: Teste que falha**: `test('sendAndRecord usa o envio dado e grava o corpo')`. Com `send: async () => 'doc-1'`, o resultado é `'doc-1'`. `db.botAddMessage` recebe `{ id: 'doc-1', direction: 'out', source: 'bot', body: '<texto>' }`, e `gateway.send` não é chamado.
- [ ] **Step 2:** `cd server && node --test test/bot-engine.test.js`. Expected: FAIL.
- [ ] **Step 3: Implementar**
  - `sendDocument`: fora de `isLive()`, devolve `sim-<uuid>`. Em `live`, faz `POST /message/sendMedia/<instância>` com `{ number, mediatype: 'document', mimetype: 'application/pdf', media: pdf.toString('base64'), fileName, caption }` e devolve `data.key.id`, com erro se faltar.
  - O `TIMEOUT_MS` dessa chamada sobe para 60000.
  - No `sendAndRecord`: `const id = await (send ? send() : gateway.send(conv.phone, text))`.
- [ ] **Step 4:** `cd server && npm test`. Expected: todos passam.
- [ ] **Step 5:** `git add server/src/bot/gateway.js server/src/bot/engine.js server/test/bot-engine.test.js` e `git commit -m "feat(bot): envio de documento pelo Evolution"`.

---

### Task 3: Endpoint de envio da prévia no Captação

**Files:**
- Modify: `server/src/bot/offer.js` (`FIXED.previewCaption`, igual à legenda das Global Constraints)
- Modify: `server/src/routes/bot.js` (nova rota)
- Modify: `web/nginx.conf` (limite de upload)
- Test: `server/test/bot-routes.test.js`

**Interfaces:**
- Consumes: `sendAndRecord(..., { allow, send })` e `gateway.sendDocument` (Task 2).
- Produces: `POST /api/bot/conversations/:leadId/preview?file=<nome>.pdf`, com corpo `application/pdf` cru de até 15 MB. Respostas:
  - `200 { ok: true, id }`;
  - `400` se o corpo estiver vazio ou não começar com `%PDF`;
  - `404` se não houver conversa;
  - `409 { error }` se o status não estiver em `['active','paused','ready_to_close']` ou se o lead estiver em opt-out;
  - `413` se passar do tamanho.

- [ ] **Step 1: Testes que falham** (no `start(t, …)` existente, com `gateway.sendDocument` falso que grava as chamadas):
  - `test('prévia: envia PDF com a legenda fixa e mantém pausada')`: com status `paused`, a resposta é 200. `sendDocument` recebe `caption === FIXED.previewCaption` e `fileName === 'previa.pdf'`. O status continua `paused`. `log.msgs[0].body` começa com a legenda e termina com `[PDF: previa.pdf]`. `notify` recebe um texto contendo `Prévia enviada para Aurora`.
  - `test('prévia: recusa lead em opt-out, encerrado ou na fila')`: dá 409 para `optedOut: true`, para `status: 'closed'` e para `status: 'queued'`, sem chamar `sendDocument`.
  - `test('prévia: recusa corpo que não é PDF')`: dá 400 para o corpo `hello`.
  - `test('prévia: aceita PDF de 5 MB')`: um `Buffer` com `%PDF` mais 5 MB dá 200.
- [ ] **Step 2:** `cd server && node --test test/bot-routes.test.js`. Expected: FAIL.
- [ ] **Step 3: Implementar**
  - Rota com `express.raw({ type: 'application/pdf', limit: '15mb' })`.
  - `fileName`: vem de `req.query.file`, aceito só se casar com `^[\w.-]{1,60}\.pdf$`. Caso contrário, usa `previa.pdf`.
  - Envio: `sendAndRecord(conv, `${FIXED.previewCaption}\n[PDF: ${fileName}]`, deps, { allow: [...], send: () => gateway.sendDocument(conv.phone, {...}) })`. Se devolver `null`, responde 409.
  - Depois do envio: `notify(`Prévia enviada para ${conv.name ?? conv.phone}.`)`.
  - Não chamar `botTransition`.
  - No `nginx.conf`: `location /api/bot/conversations/ { client_max_body_size 20m; …mesmos proxy_* de /api/ }`.
- [ ] **Step 4:** `cd server && npm test`. Expected: todos passam.
- [ ] **Step 5: Deploy e conferência**
  - Fazer o deploy pelo procedimento das Global Constraints.
  - `ssh servidor 'curl -s -o /dev/null -w "%{http_code}" -u <login> -X POST -H "Content-Type: application/pdf" --data-binary hello "http://127.0.0.1:8090/api/bot/conversations/x/preview"'`.

  Expected: `404`, porque a conversa não existe. Isso prova que a rota passa pelo nginx com autenticação.
- [ ] **Step 6:** `git add server/src/bot/offer.js server/src/routes/bot.js server/test/bot-routes.test.js web/nginx.conf` e `git commit -m "feat(bot): rota para enviar a prévia em PDF ao lead"`.

---

### Task 4: Registro de pedidos e leads do `jarvis-previas`

**Files:**
- Create: `jarvis-previas/package.json` (`"type": "module"`, `"test": "node --test test/"`, sem dependências)
- Create: `jarvis-previas/src/store.js`
- Create: `jarvis-previas/src/captacao.js`
- Test: `jarvis-previas/test/store.test.js`, `jarvis-previas/test/captacao.test.js`

**Interfaces:**
- Produces: `createStore(dataDir) -> { create({ leadId, leadName, phone, observacao }) -> pedido, get(id), list() -> pedido[] /* mais recentes primeiro */, update(id, patch) -> pedido }`.
  - `pedido = { id /* 8 chars [a-z0-9] */, leadId, leadName, phone, observacao, estado, fotos: number, criadoEm, atualizadoEm, erro?: string, enviadoHash?: string }`.
  - `estado ∈ 'recebendo' | 'na_fila' | 'montando' | 'previa_pronta' | 'enviado' | 'encerrado' | 'erro'`.
  - O arquivo é `data/pedidos.json`, com gravação atômica (escreve `.tmp` e faz `rename`).
- Produces: `createCaptacao({ url, auth }) -> { leads() -> Promise<{ leadId, name, phone, pediuPrevia: boolean }[]>, sendPreview(leadId, pdf: Buffer, fileName) -> Promise<{ ok: true } | { ok: false, status, error }> }`.
  - `leads()` lê `GET /api/bot/conversations`, mantém só os status `active`, `paused` e `ready_to_close` e ordena com `pediuPrevia` (`status==='paused' && reason==='preview_requested'`) no topo, depois por nome.
  - `auth` é `user:senha` em Basic.

- [ ] **Step 1: Testes que falham**
  - `test('create gera id de 8 chars e estado recebendo')`.
  - `test('update persiste entre instâncias')`: cria, atualiza, abre `createStore` de novo no mesmo diretório e confere o estado.
  - `test('leads filtra status e põe quem pediu prévia no topo')`: o fetch falso devolve conversas `closed`, `queued`, `opted_out`, `active` (Bruno), `paused/preview_requested` (Zélia) e `paused/manual` (Ana). O resultado deve ser `['Zélia','Ana','Bruno']`.
  - `test('sendPreview devolve status e erro do Captação')`: 409 com `{error:'x'}` vira `{ ok:false, status:409, error:'x' }`.
- [ ] **Step 2:** `cd jarvis-previas && npm test`. Expected: FAIL.
- [ ] **Step 3: Implementar** os dois módulos. `createCaptacao` recebe `fetch` opcional, para os testes.
- [ ] **Step 4:** `cd jarvis-previas && npm test`. Expected: PASS.
- [ ] **Step 5:** `git add jarvis-previas/package.json jarvis-previas/src jarvis-previas/test` e `git commit -m "feat(jarvis-previas): registro de pedidos e leads do Captação"`.

---

### Task 5: API HTTP do `jarvis-previas`

**Files:**
- Create: `jarvis-previas/src/server.js`
- Create: `jarvis-previas/src/main.js` (lê a config e sobe o servidor e o runner)
- Test: `jarvis-previas/test/server.test.js`

**Interfaces:**
- Consumes: `createStore` e `createCaptacao` (Task 4), mais `runner.kick()` (Task 6, falso no teste).
- Produces: `createServer({ store, captacao, runner, jobsDir, token }) -> http.Server`. Toda rota exige `Authorization: Bearer <token>` e responde 401 sem ele, comparando com `timingSafeEqual`.
  - `GET /leads` → `{ leads }`.
  - `POST /pedidos` com JSON `{ leadId, observacao? }`:
    - 400 se o lead não está em `leads()`;
    - caso contrário, cria o pedido `recebendo`, cria `jobs/<id>/fotos/` e grava `jobs/<id>/lead.json` (`{ nome, telefone, observacao }` com os dados do Captação) → `201 { id }`.
  - `POST /pedidos/:id/fotos` com corpo cru de `image/jpeg`, `image/png` ou `image/webp`, até 15 MB:
    - grava `fotos/NN.<ext>` e soma 1 em `fotos` → `201 { fotos }`;
    - 415 para outro tipo, 413 acima do limite, 409 se o estado não for `recebendo`.
  - `POST /pedidos/:id/iniciar` → 400 sem fotos. Caso contrário, `estado: 'na_fila'`, `runner.kick()` → `200`.
  - `GET /pedidos` → `{ pedidos }`.
  - `GET /pedidos/:id/previa.pdf` → o arquivo `jobs/<id>/saida/previa.pdf`, ou 404.
  - `POST /pedidos/:id/cancelar` → `runner.stop(id)` e `estado: 'encerrado'`.
- `main.js` lê:
  - `/srv/jarvis-previas/config/config.json`: `{ token, captacaoUrl, captacaoAuth, porta: 8095 }`;
  - `jobsDir=/srv/jarvis-previas/jobs` e `dataDir=/srv/jarvis-previas/data`.

  Escuta só em `127.0.0.1:8095`. O acesso pelo Tailscale vem do `tailscale serve --https=8095`, que já entrega HTTPS e nunca expõe fora da tailnet.

- [ ] **Step 1: Testes que falham**
  - `test('sem token: 401')`.
  - `test('fluxo: cria, manda 2 fotos, inicia')`: confere os estados e os arquivos `fotos/01.jpg` e `fotos/02.png`, e que `kick` foi chamado.
  - `test('foto HEIC: 415; foto de 16 MB: 413')`.
  - `test('lead fora da lista: 400')`.
  - `test('iniciar sem fotos: 400')`.
  - `test('id com ../ ou maiúsculas: 404')`.
- [ ] **Step 2:** `cd jarvis-previas && npm test`. Expected: FAIL.
- [ ] **Step 3: Implementar** com `node:http`, sem framework. O ID na URL precisa casar com `^[a-z0-9]{8}$` antes de qualquer acesso a disco.
- [ ] **Step 4:** `cd jarvis-previas && npm test`. Expected: PASS.
- [ ] **Step 5:** `git add jarvis-previas/src/server.js jarvis-previas/src/main.js jarvis-previas/test/server.test.js` e `git commit -m "feat(jarvis-previas): API dos pedidos para o APK"`.

---

### Task 6: Runner das sessões

**Files:**
- Create: `jarvis-previas/src/runner.js`
- Create: `jarvis-previas/agent/CLAUDE.md` (modelo inicial, refinado na Task 8)
- Test: `jarvis-previas/test/runner.test.js`

**Interfaces:**
- Consumes: `store` (Task 4).
- Produces: `createRunner({ store, jobsDir, agentDir, tmux, now = Date.now, max = 2 }) -> { kick(), tick(), stop(id) }`. O `tmux` é injetado, com `{ start(name, cwd, prompt), alive(name) -> boolean, kill(name) }`. Em produção, usa `execFile('sudo', ['-u','previas','tmux', ...])`.
- Regras do `tick()`, que roda a cada 10 s e no `kick()`:
  1. Para cada pedido `montando` ou `previa_pronta`:
     - se `jobs/<id>/saida/previa.pdf` existe e o estado é `montando` → `previa_pronta`;
     - se a sessão não está viva → `encerrado`;
     - se `now - atualizadoEm` em `montando` passa de 6 h → `kill` e `encerrado` com `erro: 'tempo esgotado'`.
  2. Para cada `enviado` cuja sessão está viva há mais de 60 s depois do envio → `kill`.
  3. Enquanto houver menos de `max` em `montando`/`previa_pronta`, pegar o `na_fila` mais antigo e:
     - copiar `agentDir/CLAUDE.md` para `jobs/<id>/`;
     - criar `saida/` (grupo `previas`, 2775);
     - pré-aceitar a confiança, se a Task 1 mostrou que é preciso;
     - `tmux.start('previa-<id>', dir, 'Monte a prévia deste pedido seguindo o CLAUDE.md. O id do pedido é <id>.')`;
     - mudar para `montando`.
  4. Apagar diretórios de pedidos com `criadoEm` acima de 30 dias e marcá-los `encerrado`.

- [ ] **Step 1: Testes que falham** (`tmux` falso e `now` controlado):
  - `test('nunca passa de 2 sessões')`: com 3 na fila, `tick` deixa 2 `montando` e 1 `na_fila`.
  - `test('PDF gerado vira previa_pronta')`.
  - `test('sessão morta vira encerrado e libera a vaga')`.
  - `test('6 h montando: kill e erro tempo esgotado')`.
  - `test('enviado: kill depois de 60 s')`.
  - `test('apaga pedidos com mais de 30 dias')`.
- [ ] **Step 2:** `cd jarvis-previas && npm test`. Expected: FAIL.
- [ ] **Step 3: Implementar** `runner.js`. Criar o `agent/CLAUDE.md` inicial com:
  - a missão: uma página, em português, com as fotos de `fotos/` e os dados de `lead.json`, sem inventar preço, prêmio, depoimento nem horário;
  - as saídas: `saida/site.html`, com imagens embutidas em base64, e `saida/previa.pdf`, gerado por `chromium --headless --no-sandbox --print-to-pdf=saida/previa.pdf saida/site.html`;
  - o passo final: rodar `sudo -u lorenzo /srv/jarvis-previas/app/bin/enviar-previa <id>` e esperar a aprovação;
  - nos ajustes pedidos por mensagem, refazer os arquivos e pedir o envio de novo.
- [ ] **Step 4:** `cd jarvis-previas && npm test`. Expected: PASS.
- [ ] **Step 5:** `git add jarvis-previas/src/runner.js jarvis-previas/agent/CLAUDE.md jarvis-previas/test/runner.test.js` e `git commit -m "feat(jarvis-previas): fila e sessões do Claude Code por pedido"`.

---

### Task 7: `enviar-previa`, instalação e teste de ponta a ponta

**Files:**
- Create: `jarvis-previas/bin/enviar-previa` (Node, executável)
- Create: `jarvis-previas/src/enviar.js` (lógica testável)
- Create: `jarvis-previas/deploy/jarvis-previas.service`, `jarvis-previas/deploy/sudoers`, `jarvis-previas/deploy/install.sh`
- Test: `jarvis-previas/test/enviar.test.js`

**Interfaces:**
- Consumes: `createStore`, `createCaptacao` (Task 4) e a rota da Task 3.
- Produces: `enviar({ id, store, captacao, jobsDir }) -> Promise<{ ok: true } | { ok: false, motivo: string }>`.
  - O ID precisa casar com `^[a-z0-9]{8}$`. O pedido precisa existir em `previa_pronta` ou `enviado`.
  - O lead vem **do registro**, nunca de arquivo do job.
  - O PDF é `jobs/<id>/saida/previa.pdf`. Se o sha256 for igual a `enviadoHash`, devolve `{ ok:false, motivo:'esta prévia já foi enviada' }`.
  - Em caso de sucesso, `update(id, { estado:'enviado', enviadoHash })`. Se o Captação devolver 409, `update(id, { estado:'erro', erro })`.
  - O binário imprime o motivo e sai com código 1 em falha, porque o agente lê a saída.
- `deploy/sudoers`:
  - `previas ALL=(lorenzo) NOPASSWD: /srv/jarvis-previas/app/bin/enviar-previa [a-z0-9]*`;
  - `lorenzo ALL=(previas) NOPASSWD: /usr/bin/tmux`.

  Validar com `visudo -cf`.
- `install.sh`, rodado no notebook: faz rsync de `jarvis-previas/` para `servidor:/srv/jarvis-previas/app`, instala o sudoers e as units systemd, e roda `tailscale serve --bg --https=8095 http://127.0.0.1:8095`.

- [ ] **Step 1: Testes que falham**
  - `test('id inválido ou com ../ é recusado sem tocar no disco')`.
  - `test('usa o lead do registro, mesmo se lead.json foi alterado')`.
  - `test('mesmo PDF duas vezes: segunda recusada')`.
  - `test('PDF alterado depois do envio: envia de novo')`.
  - `test('409 do Captação vira estado erro com a mensagem')`.
- [ ] **Step 2:** `cd jarvis-previas && npm test`. Expected: FAIL.
- [ ] **Step 3: Implementar** `enviar.js`, o binário e os arquivos de deploy. A config com as credenciais (`config.json`) fica com dono `lorenzo` e modo 600, e não pode ser lida por `previas`.
- [ ] **Step 4:** `cd jarvis-previas && npm test`. Expected: PASS.
- [ ] **Step 5: Instalar e conferir o isolamento**
  - Rodar `./jarvis-previas/deploy/install.sh`.
  - Conferir que `sudo -u previas cat /srv/jarvis-previas/config/config.json` falha.
  - Conferir que `sudo -u previas docker ps` falha.
  - Conferir que `curl -H "Authorization: Bearer <token>" https://servidor.tail1458e4.ts.net:8095/leads` responde a lista.
- [ ] **Step 6: Ponta a ponta com o lead de teste** (autorizado pelo Lorenzo)
  - Inserir em `bot_conversations` uma conversa do número `OWNER_WHATSAPP`, com `status='paused'` e `reason='preview_requested'`, nome "Teste Lorenzo".
  - Criar um pedido com 2 fotos via `curl` e acompanhar no Habblaud.
  - Aprovar pelo celular.

  Expected: o PDF chega ao WhatsApp do Lorenzo com a legenda, o pedido vira `enviado`, o `notify` avisa e a sessão some depois de cerca de 60 s.

  Depois, **apagar a conversa de teste**, para os avisos do bot ao Lorenzo não caírem nela.
- [ ] **Step 7:** `git add jarvis-previas/bin jarvis-previas/src/enviar.js jarvis-previas/deploy jarvis-previas/test/enviar.test.js` e `git commit -m "feat(jarvis-previas): envio aprovado e instalação no servidor"`.

---

### Task 8: Guia do agente com o padrão do Lorenzo (depende do material)

**Bloqueada até o Lorenzo mandar** as instruções da conversa de sites do Mac e 2 ou 3 PDFs já enviados.

**Files:**
- Modify: `jarvis-previas/agent/CLAUDE.md`
- Create: `jarvis-previas/agent/exemplos/` (PDFs de referência)

- [ ] **Step 1:** Ler o material e reescrever o `CLAUDE.md` com:
  - a estrutura de seções usada nos PDFs;
  - o tom dos textos;
  - a paleta por ramo;
  - o tamanho do PDF (páginas e formato);
  - o que nunca inventar.
- [ ] **Step 2:** Rodar um pedido real para o lead de teste, usando fotos de um comércio de verdade, e mostrar o PDF ao Lorenzo ao lado de um exemplo dele.

  Expected: Lorenzo diz que está no nível do Mac. Se não estiver, ajustar o guia e repetir.
- [ ] **Step 3:** Deploy com `install.sh`. Depois, `git add jarvis-previas/agent` e `git commit -m "feat(jarvis-previas): guia do agente no padrão das prévias do Lorenzo"`.

---

### Task 9: APK "Jarvis"

**Files:**
- Create: `jarvis-android/AndroidManifest.xml`, `jarvis-android/build.sh` (cópia adaptada de `~/Documentos/app/vigia-android/build.sh`, com pacote `app.jarvis` e saída `jarvis.apk`)
- Create: `jarvis-android/src/app/jarvis/MainActivity.java` (abas Pedidos e Escritório), `NovoPedidoActivity.java`, `Api.java`, `ConfigActivity.java`
- Modify: `.gitignore` (`jarvis-android/build/`, `*.keystore` e `*.apk`)

**Interfaces:**
- Consumes: a API da Task 5 em `https://servidor.tail1458e4.ts.net:8095` e o Habblaud em `https://servidor.tail1458e4.ts.net:4747`.
- `NovoPedidoActivity` recebe `ACTION_SEND` e `ACTION_SEND_MULTIPLE` com `image/*`. Depois:
  1. mostra as miniaturas;
  2. tem o botão "Adicionar da galeria";
  3. mostra a lista de `GET /leads` com marcação "pediu prévia" e busca;
  4. tem o campo "Observação";
  5. em "Montar prévia": `POST /pedidos`, depois uma chamada `POST /pedidos/:id/fotos` por foto e por fim `POST /pedidos/:id/iniciar`.

  Reduz fotos maiores que 2000 px no lado maior para JPEG com qualidade 85 antes de enviar. Isso também converte HEIC.
- `MainActivity`:
  - aba **Pedidos**: lista `GET /pedidos` (nome, estado em português e hora), com atualização ao abrir e ao puxar para baixo, e o botão **"Ver prévia"** quando o estado for `previa_pronta` ou `enviado`. O botão baixa o PDF com o token e abre no visualizador do Android via `FileProvider`;
  - aba **Escritório**: WebView do Habblaud, com JavaScript, DOM storage e cookies persistentes.
- Sem servidor ou token salvos, abre a `ConfigActivity`. Em falha de rede, mostra: "Não consegui falar com o servidor. O Tailscale do celular está ligado?"

- [ ] **Step 1:** `cd jarvis-android && ./build.sh`. Expected: `ok: …/jarvis.apk`.
- [ ] **Step 2: Lorenzo instala e confere** no celular:
  1. Configura o servidor e o token.
  2. Compartilha 3 fotos da galeria com o "Jarvis", escolhe "Teste Lorenzo" e toca em "Montar prévia".
  3. O pedido aparece como "montando" e depois "prévia pronta". O "Ver prévia" abre o PDF.
  4. Na aba Escritório, aprova, e o PDF chega ao WhatsApp dele.
  5. Com o Tailscale desligado, o aviso aparece.
- [ ] **Step 3:** `git add jarvis-android .gitignore` e `git commit -m "feat(jarvis-android): APK para mandar fotos, ver e aprovar prévias"`.

# Funil automático Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pedido de prévia abre sozinho quando o lead pede, o Lorenzo só aprova o PDF com um toque e o bot retoma a conversa depois do envio.

**Architecture:** O Captação ganha três coisas: rota da foto de perfil, rota de aviso "prévia pronta" e retomada da conversa depois do envio. O `jarvis-previas` ganha `src/auto.js`, chamado a cada tick: cria pedidos automáticos a partir das conversas `preview_requested` recentes e avisa o Captação quando o agente pede a aprovação do envio.

**Tech Stack:** Node 20 (ESM), Express no Captação, `node:http` no jarvis-previas, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-funil-automatico-design.md`

## Global Constraints

- Nenhum PDF chega ao lead sem a aprovação do Lorenzo: o `enviar-previa` continua `ask`.
- Nenhum custo novo.
- O Evolution só é chamado de dentro do Captação.
- Só pedidos automáticos para conversas pausadas com `preview_requested` há **no máximo 48 h**. As antigas, como a do Studio Lais Vargas, não entram.
- Nada de pedido novo se o lead já tem pedido em aberto (`recebendo`, `na_fila`, `montando`, `previa_pronta`) ou recebeu um pedido `enviado` nos últimos **30 dias**.
- Texto do aviso: `Prévia de <nome> pronta. Aprove no app Jarvis.`

## Review Focus

- Captação fora do ar ou respondendo com erro no tick: o `auto.passo` não pode derrubar o `runner.tick`, e o erro só vai para o log. Teste em Task 2.
- Lead sem foto de perfil (404) ou com Evolution fora: o pedido segue sem foto. Testes em Task 1 e Task 2.
- Dois ticks seguidos com o mesmo lead: um único pedido. Teste em Task 2.
- Aviso de prévia pronta repetido a cada tick: tem de sair uma vez por pedido. Teste em Task 2.
- Prévia enviada para uma conversa pausada por outro motivo (`owner_replied`): continua pausada. Teste em Task 1.

---

### Task 1: Captação: foto, aviso e retomada

**Files:**
- Modify: `server/src/bot/gateway.js` (nova `profilePicture(phone)`)
- Modify: `server/src/routes/bot.js:143-157` (rota `/preview`, rotas novas `/photo` e `/preview-ready`)
- Modify: `server/src/db.js:508` (`botList` traz `address` e `city`)
- Test: `server/test/bot-routes.test.js`

**Interfaces:**
- Produces:
  - `GET /api/bot/conversations/:leadId/photo`: devolve 200 com a imagem e o `Content-Type` original, ou 404 `{ error }`.
  - `POST /api/bot/conversations/:leadId/preview-ready`: devolve 200 `{ ok: true }` e chama `notify`, ou 409 quando o status não está em `PREVIEW_OK`.
  - Cada linha de `GET /api/bot/conversations` ganha `address` e `city`, além dos campos atuais (`niche`, `updated_at`, `reason`).
  - `gateway.profilePicture(phone) -> Promise<{ buffer: Buffer, type: string } | null>`: `POST /chat/fetchProfilePictureUrl/{instance}` com `{ number }`, depois baixa `profilePictureUrl` (timeout de 15 s, no máximo 5 MB, só `image/*`). Qualquer falha devolve `null`.

- [ ] **Step 1: Testes que falham** em `bot-routes.test.js`. O `deps.gateway` do `start()` ganha `profilePicture: async () => photo`, com `photo` configurável.
  - `foto de perfil: devolve a imagem ou 404`: com `{ buffer: Buffer.from('img'), type: 'image/jpeg' }` → 200, `content-type` `image/jpeg`, corpo `img`; com `null` → 404.
  - `prévia pronta avisa o Lorenzo`: status `paused` → 200, e `log.notes` contém `Prévia de Aurora pronta. Aprove no app Jarvis.`; status `closed` → 409, sem nota.
  - `depois da prévia pedida, a conversa volta para o bot`: `reason: 'preview_requested'`, envio do PDF → 200, e `conv.status === 'active'`.
  - `prévia em conversa assumida pelo Lorenzo continua pausada`: `reason: 'owner_replied'` → depois do envio, `conv.status === 'paused'`.
  - O `start()` aceita `reason` (padrão `'manual'`).
- [ ] **Step 2:** `npm --prefix server test`. Os 4 testes novos falham.
- [ ] **Step 3:** Implementar. Na rota `/preview`, depois de enviar: se `conv.status === 'paused' && conv.reason === 'preview_requested'`, chamar `db.botTransition(conv.lead_id, ['paused'], 'active')`. No `botList`, usar subconsultas `(SELECT address FROM leads l WHERE l.lead_id = c.lead_id AND l.address IS NOT NULL LIMIT 1) AS address` e `(SELECT city FROM searches s WHERE s.id = c.search_id) AS city`.
- [ ] **Step 4:** `npm --prefix server test`. Todos passam.
- [ ] **Step 5:** Commit `feat(bot): foto de perfil, aviso de prévia pronta e bot retoma após a prévia`.

### Task 2: jarvis-previas: pedidos automáticos

**Files:**
- Create: `jarvis-previas/src/auto.js`
- Modify: `jarvis-previas/src/captacao.js` (`leads()` traz mais campos; novas `photo` e `previewReady`)
- Modify: `jarvis-previas/src/server.js:87-97` (usa `escreverLead` do `auto.js`)
- Modify: `jarvis-previas/src/main.js` (chama `auto.passo()` antes de `runner.tick()`)
- Test: `jarvis-previas/test/auto.test.js`, `jarvis-previas/test/captacao.test.js`

**Interfaces:**
- Consumes: as rotas da Task 1.
- Produces:
  - Cada item de `captacao.leads()` ganha `niche`, `address`, `city` e `pausadoEm` (ms de `updated_at`).
  - `captacao.photo(leadId) -> Promise<{ buffer: Buffer, type: string } | null>`: 404 vira `null`, e outros erros são lançados.
  - `captacao.previewReady(leadId) -> Promise<void>`.
  - `escreverLead(dir, lead, observacao)`: grava `lead.json` com `{ nome, telefone, ramo, endereco, cidade, observacao }`, omitindo os campos vazios.
  - `createAuto({ store, captacao, jobsDir, now }) -> { passo(): Promise<void> }`.
  - O pedido automático tem `automatico: true` e `fotos` igual a 0 ou 1. A foto, quando existe, fica em `fotos/01.<jpg|png|webp>`.

- [ ] **Step 1: Testes que falham** em `auto.test.js` (o `captacao` é falso):
  - `cria pedido para quem pediu prévia há pouco e coloca na fila`: um lead com `pediuPrevia` e `pausadoEm = now - 1h` vira um pedido com `estado: 'na_fila'`, `automatico: true`, `fotos: 1`; existe `fotos/01.jpg`, e o `lead.json` tem `ramo` e `cidade`.
  - `ignora pedido de prévia com mais de 48 h`.
  - `não duplica`: dois `passo()` seguidos criam 1 pedido; um lead com pedido `enviado` há 10 dias não ganha outro; com 31 dias, ganha.
  - `sem foto segue sem foto`: `photo` devolve `null` → `fotos: 0`, `na_fila`.
  - `foto com erro não impede o pedido`: `photo` lança erro → o pedido vai `na_fila` com `fotos: 0`.
  - `avisa uma vez quando o agente pede aprovação`: um pedido com `aguardandoAprovacao: true` → `previewReady` é chamado 1 vez em dois `passo()`, e o pedido ganha `avisadoEm`.
  - `Captação fora do ar não lança erro`: `leads()` rejeita → `passo()` resolve.

  Em `captacao.test.js`: `leads` mapeia `niche`, `address`, `city` e `pausadoEm`; `photo` com 404 devolve `null`.
- [ ] **Step 2:** `cd jarvis-previas && npm test`. Os testes novos falham.
- [ ] **Step 3:** Implementar `auto.js`. Cada etapa do `passo` fica em `try/catch` com `console.error('[jarvis-previas] auto:', e.message)`. O aviso vale para qualquer pedido, manual ou automático, com `aguardandoAprovacao && !avisadoEm`. A `observacao` do automático é `Pedido automático: sem fotos do Lorenzo. Use a foto de perfil (se houver) como logo.`
- [ ] **Step 4:** `npm test`. Todos passam. O teste do `server.test.js` sobre o `lead.json` continua passando, porque os campos vazios são omitidos.
- [ ] **Step 5:** Commit `feat(jarvis-previas): pedido de prévia automático e aviso de prévia pronta`.

### Task 3: Agente sabe montar sem fotos

**Files:**
- Modify: `jarvis-previas/agent/CLAUDE.md`

- [ ] **Step 1:** Em "O que você recebe", incluir os campos novos do `lead.json` (`ramo`, `endereco`, `cidade`). Acrescentar a seção "Pedido automático (sem fotos ou só com a logo)": layout tipográfico com cor e forma; a foto de perfil vira logo quando parecer logo e, quando for de pessoa, vai pequena ou não entra; **nunca** imagem de banco nem foto inventada; a galeria sai do site.
- [ ] **Step 2:** Commit `docs(jarvis-previas): agente monta prévia sem fotos`.

### Task 4: Deploy e verificação

- [ ] **Step 1:** Captação: `rsync` de `server/` para `servidor:/srv/captacao/server/` (sem `node_modules` e sem `.env`), depois `docker compose up -d --build api` em `/srv/captacao`. A API deve voltar `healthy`.
- [ ] **Step 2:** `jarvis-previas`: copiar `src/` e `agent/` para `/srv/jarvis-previas/app/` e rodar `sudo systemctl restart jarvis-previas`. O log deve mostrar `ouvindo em 127.0.0.1:8095` sem erro do `auto`.
- [ ] **Step 3:** Verificar a foto de perfil de um lead real ativo pela rota nova: 200 ou 404, sem 500.
- [ ] **Step 4:** Conferir que nenhum pedido automático foi criado para conversas antigas.
- [ ] **Step 5:** Push e relatório ao Lorenzo pelo WhatsApp do bot.

# Checklist do bot de WhatsApp

- [x] **1. Como o bot responde.** As palavras-chave cuidam de "parar" e "é robô?". A IA só classifica a mensagem. Todo texto enviado é fixo e vem de `server/src/bot/offer.js`.
- [ ] **2. Onde o sistema roda e avisos no celular**
  - [x] Decidido: tudo roda no ZimaOS; o notebook só administra
  - [x] Migrado para o Zima em 05/11: app em `/DATA/AppData/captacao`, site em `http://IP-DO-ZIMA:8090`, WhatsApp conectado sem novo QR code. O notebook não roda mais nada
  - [x] Aviso imediato no WhatsApp quando o bot pausa ou o lead aceita (`OWNER_WHATSAPP`)
  - [x] Assumir a conversa: responder ao lead pelo celular pausa o bot
  - [x] Resumo a cada 5 min, só quando há novidade: quem foi chamado (com nicho), quem respondeu, quantos faltam
  - [ ] Ver o resumo chegando no celular durante o teste real
- [ ] **3. Roteiro de teste com WhatsApp real:** desconto, pausa pelo celular, parcelar, robô, aceite, reinício, queda
- [ ] **4. Restaurar o horário de envio** para 09:00–18:00 em dias úteis
- [ ] **5. Definir cidades e nichos**
- [ ] **6. Começar com 1 lead por dia**
- [ ] **7. Trocar a chave do Gemini e as outras senhas**
- [ ] **8. Enviar a branch ao GitHub** (`git push -u origin fix/boot-e-seguranca-docker`)

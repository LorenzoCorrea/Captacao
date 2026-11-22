# Prévia de site para um lead

Você monta a **prévia de um site** para um pequeno negócio que conversa com o Lorenzo pelo WhatsApp. Ela vira um PDF, e o Lorenzo manda esse PDF ao dono do negócio depois de aprovar. O objetivo é o dono se ver num site bonito e real e querer fechar.

## O que você recebe (nesta pasta)

- `fotos/`: fotos do negócio que o Lorenzo escolheu (fachada, ambiente, serviços, equipe, logo).
- `lead.json`: `nome` do negócio, `telefone` e uma `observacao` opcional do Lorenzo, como "usar tons de verde". Siga a observação.

## Como desenhar

O site precisa parecer feito por um estúdio de design, não um modelo genérico. Antes de escrever o HTML:

1. **Direção de arte:** use a skill `design-taste-frontend`. Rode o `draw.mjs` dela com o ramo do negócio, escolha a direção que combina com o lead e siga a tipografia, a paleta e as composições que ela sortear. Os scripts que abrem navegador (`inspect.mjs`) não funcionam aqui: pule-os. O `lint.mjs` funciona.
2. **Acabamento:** da skill `impeccable`, leia direto `reference/craft-floor.md` (o piso de qualidade e o que é proibido). Não rode o launcher `scripts/impeccable`, porque ele precisa de internet, e não rode `init`: o `lead.json` é o briefing.
3. **Tipografia e contenção:** da skill `apple-design`, use as partes de tipografia e de hierarquia. As partes de gesto e movimento não valem para PDF.
4. **Referências:** em `/srv/jarvis-previas/referencias/supahero/` há 33 topos de sites premiados, a maioria de negócios com foto forte (hotel, restaurante, beleza, bem-estar, vinho, comida, loja, interiores). Olhe 2 ou 3 do ramo mais próximo antes de compor o topo. Inspire-se na composição, não copie.

Ninguém vai responder perguntas: decida sozinho e siga em frente.

## O que você entrega

1. `saida/site.html`: uma página só, em português do Brasil, num arquivo único.
   - Embuta as fotos em base64 (`data:image/...`). Não use links para arquivos, CDNs nem `<link>` de fontes, porque o PDF é gerado sem internet.
   - **Fontes:** todas as fontes que a `design-taste-frontend` sorteia já estão instaladas no servidor, tanto as do Google Fonts quanto as do Fontshare (Switzer, Zodiak, General Sans, Clash Grotesk, Cabinet Grotesk, Boska, Erode, Sentient, Gambarino, Chillax, Panchang, Roundo e Pilcrow Rounded). Use só o nome no CSS, como `font-family: 'Zodiak', serif;`.
   - Seções sugeridas: topo com o nome e uma frase forte, serviços, galeria com as fotos, como chegar ou contato, e um botão de WhatsApp com o telefone do `lead.json`.
   - **Nada de formulário:** sem campos (`input`, `textarea`, `select`) nem caixas para preencher, porque ninguém preenche um PDF. O contato é só o botão de WhatsApp e o telefone escrito.
   - **O PDF é uma foto da página no instante em que ela carrega.** Nada pode depender de animação, rolagem ou mouse para aparecer: nada de `opacity: 0` inicial, `gsap.from`, ScrollTrigger nem efeito de entrada, porque sairia pela metade ou invisível. Pense na largura de A4.
   - **3D (opcional):** o Three.js está em `/srv/jarvis-previas/referencias/bibliotecas/three.module.min.js` e funciona no PDF. Embuta-o como módulo em base64 (`import * as THREE from 'data:text/javascript;base64,...'`), crie o renderer com `preserveDrawingBuffer: true` e chame `renderer.render()` uma vez, logo ao carregar. Use só quando um elemento 3D realmente valorizar o negócio. O GSAP está na mesma pasta, mas animação não aparece no PDF, então não use.
2. `saida/previa.pdf`: gere com o comando abaixo, sem argumentos, de dentro desta pasta:
   ```
   /srv/jarvis-previas/app/bin/gerar-pdf
   ```
   Rode esse comando **sozinho**, sem `&&`, `;` ou `|`. Comando composto não é reconhecido e falha. Depois, num comando separado, confira o tamanho com `ls -la saida`. Se passar de 12 MB, reduza as fotos e gere de novo.
3. **Confira o resultado:** depois de gerar o PDF, abra `saida/previa.pdf` com a ferramenta de leitura e olhe as páginas. Corrija o que estiver quebrado, cortado ou sem a fonte certa antes de pedir o envio.

## Regras

- **Nunca invente fatos:** nada de preços, prêmios, anos de mercado, depoimentos, horários, endereço ou nomes de pessoas que não estejam no `lead.json` ou visíveis nas fotos. Na dúvida, use textos genéricos e honestos.
- Crie e edite arquivos **com a ferramenta de escrita de arquivos**, nunca com `>` ou `cat <<` no shell. O shell pede permissão e trava o pedido.
- Você não tem internet, e isso é de propósito. Não tente baixar nada.

## Enviar

Quando o PDF estiver pronto e conferido, peça o envio rodando, sem argumentos e de dentro desta pasta:

```
/srv/jarvis-previas/app/bin/enviar-previa
```

Rode também **sozinho**, sem nada encadeado. Esse comando **pede a aprovação do Lorenzo** e espera. Ele vê a prévia pelo celular e aprova ou recusa. Não tente outro jeito de enviar.

- Se ele mandar ajustes por mensagem, refaça o `site.html`, gere o PDF de novo e peça o envio outra vez.
- Se o envio falhar, mostre a mensagem de erro e espere instruções.
- Depois de "enviado", seu trabalho acabou.

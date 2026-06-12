# Captação — Prospecção B2B em mapa interativo

Dashboard estilo "busca imobiliária": mapa interativo (Leaflet + OpenStreetMap,
custo zero) de um lado, lista de leads do outro. Busca negócios **sem website**
por nicho/cidade/raio e enriquece os contatos (e-mail, Instagram, Facebook…)
**em tempo real via SSE**, sem travar a tela.

> **100% gratuito, sem chaves de API e sem cartão de crédito.** Os dados dos
> estabelecimentos vêm do **OpenStreetMap (Overpass API)** e o enriquecimento de
> contatos é feito por busca no **DuckDuckGo**. Nenhuma cobrança envolvida.

## Rodando (2 terminais)

```powershell
# Terminal 1 — API (Node 18+)
cd server; npm install; npm run dev      # http://localhost:3001

# Terminal 2 — Front
cd web; npm install; npm run dev         # http://localhost:5173

# Uma vez, para o worker de enriquecimento (Python 3.10+):
py -m pip install -r workers/requirements.txt
```

Abra http://localhost:5173, digite um nicho, escolha a cidade/raio e clique em
**Buscar leads sem site**. Os pinos aparecem (laranja = buscando contatos);
conforme o worker Python encontra e-mail/redes, os pinos ficam verdes e os
contatos pingam nos cards. Clicar num card dá zoom no pino (e vice-versa) e
**fura a fila** do enriquecimento daquele lead.

## Como funciona, de ponta a ponta

| Etapa | Tecnologia (gratuita) | Arquivo |
|---|---|---|
| Autocomplete de cidade (texto → lat/lng) | OpenStreetMap / **Nominatim** | `server/src/data/geocode.js` |
| Busca de estabelecimentos + filtro "sem site" | OpenStreetMap / **Overpass API** | `server/src/data/osmProvider.js` |
| Fila + sessões SSE + concorrência | Node, fila em memória | `server/src/enrichment/enricher.js` |
| Enriquecimento (e-mail, Instagram, Facebook, LinkedIn) | **Python + DuckDuckGo** | `workers/enrich.py` |
| Exportação CSV / Excel + webhook CRM | Node + **exceljs** | `server/src/export/exporter.js` |
| Mapa + lista + **Kanban** (funil drag-and-drop) | React + react-leaflet + tiles OSM | `web/src/` |

O filtro do produto é nativo: o Overpass expõe a tag `website`, então
descartamos quem a tem e ficamos só com os negócios **sem site**.

## Arquitetura em duas fases

1. **`POST /api/search`** — síncrono (~1–3 s): Overpass + filtro "sem website",
   devolve os leads básicos. Pinos e cards renderizam imediatamente.
2. **`GET /api/search/:id/stream`** — SSE: cada lead enriquecido (worker Python)
   vira um evento `enrichment`; `done` encerra. Reconexão automática + replay.
3. **`POST .../leads/:id/prioritize`** — enriquecimento sob demanda (o lead
   clicado fura a fila).

## Visões: Mapa e Kanban

Alterne no canto da barra lateral entre **🗺 Mapa** e **🗂 Kanban**. O Kanban é um
funil de vendas com drag-and-drop nativo (sem biblioteca): arraste os leads entre
**Novo · Qualificado · Contatado · Ganho · Descartado**. O estágio é salvo na
sessão (**`PATCH /api/search/:id/leads/:leadId`** com `{ "stage": "..." }`) e sai
na coluna *Estágio* da exportação.

## Exportação e webhook

A barra lateral mostra botões **CSV** e **Excel** assim que há resultados. Por
baixo:

- **`GET /api/search/:id/export?format=csv|xlsx`** — baixa a planilha (CSV com
  BOM UTF-8 e Excel `.xlsx` com cabeçalho congelado e autofiltro). Colunas: nome,
  telefone, endereço, e-mail, Instagram, Facebook, LinkedIn, WhatsApp, status,
  confiança, origem, lat/lng.
- **`POST /api/search/:id/webhook`** com `{ "url": "https://seu-crm/..." }` —
  faz POST do JSON dos leads para a URL do seu CRM. _Em produção, barrar IPs
  internos antes de postar (proteção contra SSRF)._

## Configuração (variáveis de ambiente, todas opcionais)

| Var | Padrão | Para quê |
|---|---|---|
| `DATA_PROVIDER` | `osm` | `mock` usa dados fictícios offline (sem rede), útil para demo |
| `ENRICH_PROVIDER` | `python` | `mock` gera contatos fictícios sem chamar o DuckDuckGo |
| `ENRICH_CONCURRENCY` | `2` | quantos leads enriquecem em paralelo (educado com o DDG) |
| `ENRICH_BACKGROUND` | `true` | `false` = só enriquece quando o usuário clica no lead |
| `PYTHON_BIN` | `py` (Win) / `python3` | binário do Python para os workers |

## Limites dos serviços gratuitos (importante)

- **Overpass** limita a ~2 consultas simultâneas por IP e, sob carga, **enfileira
  a resposta** (pode levar alguns segundos). Há um **cache de 10 min** por
  busca (`osmProvider.js`) para não repetir consultas. Se vier "Overpass
  ocupado", espere alguns segundos ou reduza o raio.
- **DuckDuckGo** também pode limitar buscas em rajada — por isso a concorrência
  é baixa e há jitter entre as chamadas. Em escala, troque por **Brave Search
  API** (free tier) ou Serper.dev. A Bing Web Search API foi aposentada (ago/2025).
- **Nominatim** (autocomplete de cidade) permite no máx. 1 req/seg por IP. O
  back-end serializa as chamadas (≥1.1s) e o front faz debounce de 450ms; há
  cache de 24h. Por padrão filtra `countrycodes=br` (mude em `geocode.js`).
- **Cobertura do OSM** varia por região/nicho e **não há avaliações** (rating
  fica vazio). Nichos bem mapeados (restaurantes, beleza, clínicas, dentistas)
  rendem mais resultados.

## Avisos

- Tiles do OSM são gratuitos mas têm política de uso justo — em produção com
  tráfego real, use um provedor de tiles (MapTiler free tier) ou self-host.
- Dados do OpenStreetMap são **ODbL**: exige atribuição (já presente no mapa).
- Coleta de contatos: o campo `source` já registra a origem do dado; ofereça
  opt-out e trate só o necessário (LGPD).
```

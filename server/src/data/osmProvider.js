// Provedor de dados REAL e 100% GRATUITO — OpenStreetMap via Overpass API.
// Sem chave, sem cartão, sem cobrança. Dados sob licença ODbL (exige atribuição,
// já presente no mapa). É a alternativa free à Google Places API.
//
// Limitações honestas vs. Google: cobertura varia por região/nicho e NÃO há
// avaliações/reviews (rating fica null). Em compensação, expõe a tag `website`,
// que é exatamente o filtro do produto ("negócios sem site").

import https from 'node:https';

const ENDPOINTS = [
  // Mirrors públicos do Overpass — se o primeiro estiver enfileirado/lento,
  // tentamos o próximo. Multiplica as chances de pegar uma instância livre.
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// Etiqueta do OSM: identifique a aplicação e um contato. A URL do repositório
// vale como contato — e-mail pessoal não vai hardcoded em repo público (spam).
// Se quiser usar e-mail, defina OSM_CONTACT no .env.
const UA = `CaptacaoLeadApp/0.1 (${process.env.OSM_CONTACT || '+https://github.com/LorenzoCorrea/Captacao'})`;

// Mapa nicho (PT-BR) -> tags OSM. `kw` são radicais SEM acento (casamos por
// substring contra o nicho normalizado). Vários grupos podem casar e somar tags.
const NICHE_GROUPS = [
  { kw: ['estetic', 'beleza', 'salao', 'manicure', 'depila', 'sobrancelha', 'cabelei', 'barbear', 'barbeiro', 'spa', 'maquia', 'unha'], tags: ['shop=beauty', 'shop=hairdresser', 'shop=massage', 'leisure=spa', 'shop=cosmetics'] },
  { kw: ['advog', 'advocacia', 'jurid'], tags: ['office=lawyer'] },
  { kw: ['nutri'], tags: ['healthcare=nutrition', 'amenity=doctors'] },
  { kw: ['dent', 'odonto'], tags: ['amenity=dentist', 'healthcare=dentist'] },
  { kw: ['clinic', 'consultor', 'medic', 'saude'], tags: ['amenity=clinic', 'healthcare=clinic', 'amenity=doctors'] },
  { kw: ['academia', 'fitness', 'crossfit', 'pilates', 'muscula'], tags: ['leisure=fitness_centre', 'leisure=sports_centre'] },
  { kw: ['restaurante', 'lanchonete', 'pizz', 'hamburg', 'cafe', 'bistro', 'padaria', 'comida'], tags: ['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe', 'shop=bakery'] },
  { kw: ['pet', 'veterin'], tags: ['amenity=veterinary', 'shop=pet'] },
  { kw: ['contab', 'contador'], tags: ['office=accountant'] },
  { kw: ['imobili', 'corretor', 'imovel'], tags: ['office=estate_agent'] },
  { kw: ['arquitet'], tags: ['office=architect'] },
  { kw: ['psicol', 'terapeut', 'terapia'], tags: ['healthcare=psychotherapist', 'office=therapist'] },
  { kw: ['fisio'], tags: ['healthcare=physiotherapist'] },
  { kw: ['otica', 'oculos'], tags: ['shop=optician'] },
  { kw: ['mecanic', 'funilaria', 'oficina', 'autocenter'], tags: ['shop=car_repair', 'craft=car_repair'] },
  // Construção civil: empreiteiras, construtoras, reformas. Cobre vários
  // crafts comuns no OSM brasileiro (pedreiros, eletricistas, marceneiros…).
  { kw: ['empreit', 'construt', 'reform', 'pedreir', 'engenh'], tags: [
      'office=construction_company', 'craft=builder', 'craft=carpenter',
      'craft=electrician', 'craft=plumber', 'craft=painter',
      'craft=tiler', 'craft=roofer', 'shop=trade',
  ] },
  { kw: ['floricult', 'flor'], tags: ['shop=florist'] },
];

const normalize = (s) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Nicho especial "todos": varre todas as categorias comerciais do OSM no raio.
const isAllNiches = (niche) => /^(todos( os nichos)?|todas|geral|tudo)$/.test(normalize(niche).trim());

// Chaves do OSM que marcam estabelecimento comercial (usadas na busca por nome
// e no nicho "todos"). amenity/leisure/tourism são filtradas por valor porque
// incluem coisas que não são negócio (banco de praça, estacionamento…).
const COMMERCIAL_KEYS = ['shop', 'amenity', 'office', 'craft', 'healthcare', 'leisure', 'tourism'];
const ALL_AMENITY = 'restaurant|fast_food|cafe|bar|pub|ice_cream|dentist|clinic|doctors|veterinary|pharmacy|driving_school|language_school|music_school|events_venue|car_wash|coworking_space';
const ALL_LEISURE = 'fitness_centre|sports_centre|dance|spa|bowling_alley';
const ALL_TOURISM = 'hotel|guest_house|hostel';

// Regex tolerante a acento: os radicais dos nichos são sem acento, mas os nomes
// no OSM têm ("estetic" precisa casar com "Estética"). Duas pegadinhas do
// Overpass: o regex é POSIX byte-a-byte (classe [á] com UTF-8 multi-byte
// quebra — por isso alternância com grupos) e o flag `i` não cobre maiúscula
// acentuada (por isso as duas caixas explícitas).
const ACCENT = {
  a: 'a|á|à|â|ã|Á|À|Â|Ã', e: 'e|é|ê|É|Ê', i: 'i|í|Í',
  o: 'o|ó|ô|õ|Ó|Ô|Õ', u: 'u|ú|û|Ú|Û', c: 'c|ç|Ç',
};
const accentRegex = (kw) =>
  kw.split('').map((ch) => (ACCENT[ch] ? `(${ACCENT[ch]})` : ch)).join('');

// Devolve as tags OSM do nicho E os radicais que casaram (para a busca por nome).
function resolveNiche(niche) {
  const n = normalize(niche);
  const tags = new Set();
  const kws = new Set();
  for (const g of NICHE_GROUPS) {
    for (const k of g.kw) {
      if (n.includes(k)) {
        kws.add(k);
        g.tags.forEach((t) => tags.add(t));
      }
    }
  }
  if (!kws.size) {
    // Nicho fora do mapa de grupos: usa as próprias palavras digitadas (>=4
    // letras, até 4 palavras) como radicais de busca por nome.
    n.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 4).slice(0, 4)
      .forEach((w) => kws.add(w));
  }
  return { tags: [...tags], kws: [...kws] };
}

function buildQuery({ tags, kws, niche, lat, lng, radiusKm }) {
  const R = Math.round(radiusKm * 1000);
  const around = `(around:${R},${lat},${lng})`;
  const clauses = [];

  if (isAllNiches(niche)) {
    // "Todos": qualquer estabelecimento com nome nas categorias comerciais.
    clauses.push(`nwr["shop"]["name"]${around};`);
    clauses.push(`nwr["office"]["name"]${around};`);
    clauses.push(`nwr["craft"]["name"]${around};`);
    clauses.push(`nwr["healthcare"]["name"]${around};`);
    clauses.push(`nwr["amenity"~"^(${ALL_AMENITY})$"]["name"]${around};`);
    clauses.push(`nwr["leisure"~"^(${ALL_LEISURE})$"]["name"]${around};`);
    clauses.push(`nwr["tourism"~"^(${ALL_TOURISM})$"]["name"]${around};`);
  } else {
    // Busca por TAG (categoria certa no OSM)…
    for (const t of tags) {
      const [k, v] = t.split('=');
      clauses.push(`nwr["${k}"="${v}"]${around};`);
    }
    // …E por NOME (pega os mal-etiquetados, que são muitos no Brasil). A busca
    // por nome exige alguma chave comercial ou telefone, senão ruas e prédios
    // com nome parecido entrariam como lead.
    if (kws.length) {
      const re = kws.map(accentRegex).join('|');
      for (const key of COMMERCIAL_KEYS) clauses.push(`nwr["name"~"${re}",i]["${key}"]${around};`);
      clauses.push(`nwr["name"~"${re}",i]["phone"]${around};`);
      clauses.push(`nwr["name"~"${re}",i]["contact:phone"]${around};`);
    }
  }
  // timeout do servidor alinhado ao do cliente (PER_MIRROR_MS) — não adianta
  // o Overpass continuar processando depois que já desistimos da resposta.
  return `[out:json][timeout:15];(${clauses.join('')});out center 250;`;
}

// node:https com `agent: false` (socket novo a cada chamada) + `family: 4`.
// Por que não usar fetch(): em processo longo, um request abortado durante uma
// fila do Overpass "envenena" o socket keep-alive do undici e TODOS os requests
// seguintes travam até o timeout. Conexão nova por chamada é imune a isso.
function overpassPost(url, query, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = 'data=' + encodeURIComponent(query);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        agent: false,
        family: 4,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': UA,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Overpass HTTP ${res.statusCode}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).elements ?? []);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    // Overpass enfileira a RESPOSTA por IP quando está sob carga (pode levar
    // vários segundos). 20s tolera picos; o cache evita repetir a consulta.
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Overpass timeout (servidor ocupado)')));
    req.on('error', reject);
    req.end(body);
  });
}

// Orçamento TOTAL de 40s para a busca: sem ele, 4 mirrors lentos em série
// custariam até 100s com o usuário olhando "Buscando…". Cada mirror recebe no
// máximo 15s (ou o que sobrar do orçamento).
const SEARCH_BUDGET_MS = 40000;
const PER_MIRROR_MS = 15000;

async function fetchOverpass(query) {
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  let lastErr;
  for (const url of ENDPOINTS) {
    const remaining = deadline - Date.now();
    if (remaining <= 1000) break; // orçamento esgotado
    try {
      return await overpassPost(url, query, Math.min(PER_MIRROR_MS, remaining));
    } catch (e) {
      lastErr = e; // tenta o próximo endpoint
    }
  }
  throw lastErr ?? new Error('Overpass indisponível');
}

function assembleAddress(t) {
  const parts = [];
  const street = t['addr:street'];
  const num = t['addr:housenumber'];
  if (street) parts.push(num ? `${street}, ${num}` : street);
  const area = t['addr:suburb'] || t['addr:neighbourhood'] || t['addr:district'];
  if (area) parts.push(area);
  const city = t['addr:city'] || t['addr:town'];
  if (city) parts.push(city);
  return parts.join(' – ') || city || area || 'Endereço não informado no OSM';
}

function mapElement(el) {
  const t = el.tags ?? {};
  const name = t.name || t['name:pt'] || t.brand;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!name || lat == null || lng == null) return null;

  const website = t.website || t['contact:website'] || t.url || t['website:official'] || t['contact:url'];
  const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || null;
  return {
    id: `osm:${el.type}/${el.id}`,
    source: 'osm', // rastreabilidade da origem do dado (boa prática LGPD)
    name,
    address: assembleAddress(t),
    phone,
    rating: null, // OSM não tem avaliações
    reviewsCount: null,
    hasWebsite: Boolean(website),
    lat,
    lng,
  };
}

// Cache em memória: buscas idênticas não re-batem no Overpass (que limita a
// 2 slots por IP). Mantém o app rápido e dentro da etiqueta do serviço gratuito.
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
// Poda periódica: sem ela, entradas expiradas nunca saem do Map e a memória
// cresce sem limite num servidor que roda 24/7.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
}, CACHE_TTL_MS).unref();

export async function buscarEstabelecimentos({ niche, city, lat, lng, radiusKm }) {
  const cacheKey = `${normalize(niche)}|${lat.toFixed(3)}|${lng.toFixed(3)}|${radiusKm}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;

  const { tags, kws } = resolveNiche(niche);
  const query = buildQuery({ tags, kws, niche, lat, lng, radiusKm });
  const elements = await fetchOverpass(query);

  const seen = new Set();
  const all = [];
  for (const el of elements) {
    const lead = mapElement(el);
    if (!lead) continue;
    const key = `${lead.name.toLowerCase()}|${lead.lat.toFixed(4)}|${lead.lng.toFixed(4)}`;
    if (seen.has(key)) continue; // dedup node/way do mesmo local
    seen.add(key);
    lead.niche = niche;
    all.push(lead);
  }
  const result = { found: all.length, leads: all.filter((l) => !l.hasWebsite) };
  cache.set(cacheKey, { ts: Date.now(), result });
  return result;
}

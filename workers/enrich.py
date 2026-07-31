"""
Worker de enriquecimento — 100% gratuito, sem chaves de API e sem cobrança.

Entrada : 1 argumento argv com JSON do lead -> {"name","city","phone","place_id"}
Saída   : 1 linha JSON no stdout -> {email,instagram,facebook,linkedin,whatsapp,confidence,partial}
          (sempre imprime JSON válido e sai com código 0, mesmo em erro/bloqueio)

Estratégia de performance (o usuário não espera demais):
  1. UMA consulta SERP por lead no caminho quente: pega redes sociais E e-mails do
     mesmo HTML (menos requests = mais rápido e menor risco de bloqueio).
  2. 2ª consulta só dispara se o e-mail não apareceu na primeira.
  3. Orçamento de tempo rígido (TIMEOUT_LEAD): estourou, devolve parcial — nunca trava.

SERP: DuckDuckGo HTML (gratuito, sem JS, sem cadastro). Em escala troque por
Brave Search API (free tier) ou Serper.dev. A Bing Web Search API foi aposentada
pela Microsoft em ago/2025.
"""

import asyncio
import json
import re
import sys
import unicodedata
from datetime import date
from html import unescape

import httpx

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}
DDG = "https://html.duckduckgo.com/html/"
BRASILAPI_CNPJ = "https://brasilapi.com.br/api/cnpj/v1/"
TIMEOUT_LEAD = 14.0  # orçamento total por lead, em segundos
TIMEOUT_CNPJ = 5.0  # sub-orçamento da etapa de CNPJ (não pode comer os contatos)

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
CNPJ_RE = re.compile(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}")
# Snippet de perfil do Instagram na SERP: "12.3K Followers, ..." / "12 mil seguidores"
FOLLOWERS_RE = re.compile(r"([\d.,]+)\s*(mil|k|m)?\s*(?:followers|seguidores)", re.I)

# Telefone BR na SERP: (55) 99123-4567 / 55 99123 4567 / +55 55 991234567.
# Muito lead do OSM só tem o FIXO da loja (sem WhatsApp), mas o celular costuma
# estar no Instagram, no Google ou em agregador — e aparece no texto da busca.
PHONE_RE = re.compile(r"(?:\+?55[\s.\-]?)?\(?([1-9]\d)\)?[\s.\-]?(\d{4,5})[\s.\-]?(\d{4})")
# DDDs que existem de verdade — evita casar CNPJ, CEP e data soltos no HTML.
DDDS_VALIDOS = {
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
    31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
    51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
    91, 92, 93, 94, 95, 96, 97, 98, 99,
}


def _first_mobile(html: str) -> str | None:
    """Primeiro CELULAR válido no texto (9 dígitos começando com 9)."""
    for m in PHONE_RE.finditer(html):
        ddd, p1, p2 = m.groups()
        if int(ddd) not in DDDS_VALIDOS:
            continue
        local = p1 + p2
        if len(local) == 9 and local.startswith("9"):
            return f"({ddd}) {local[:5]}-{local[5:]}"
    return None
# Resultados do DDG HTML usam <a class="result__a" href="https://destino-real">.
# (Em 2024 deixaram de usar o redirect /l/?uddg=, então lemos a href direta.)
HREF_RE = re.compile(r'href="(https?://[^"]+)"', re.I)
EMAIL_BLOCK = (".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif")
DOMAIN_BLOCK = ("duckduckgo.com", "example.com", "w3.org", "sentry", "wixpress.com", "@2x")

# Domínios que NÃO contam como "site próprio" — o OSM nos disse que o lead não
# tem site, mas a tag pode estar desatualizada. Aqui filtramos para evitar
# falsos negativos: redes sociais, agregadores, marketplaces, mapas, etc.
NON_WEBSITE_HOSTS = (
    # Redes sociais
    "instagram.com", "facebook.com", "linkedin.com", "twitter.com", "x.com",
    "tiktok.com", "youtube.com", "youtu.be", "pinterest.com", "whatsapp.com",
    "wa.me", "t.me", "threads.net",
    # Mapas e listagens de negócios
    "google.com", "google.com.br", "goo.gl", "maps.app.goo.gl", "waze.com",
    "foursquare.com", "yelp.com",
    # Agregadores BR (advocacia, saúde, comércio, etc.)
    "jusbrasil.com.br", "oab.org.br", "advogados.com.br",
    "doctoralia.com.br", "consultaremedios.com.br", "boaconsulta.com",
    "guiamais.com.br", "telelistas.net", "apontador.com.br", "solutudo.com.br",
    "olx.com.br", "mercadolivre.com.br", "ifood.com.br", "rappi.com.br",
    # Diretórios e plataformas
    "wikipedia.org", "yellowpages.com", "tripadvisor.com", "booking.com",
    "reclameaqui.com.br", "econodata.com.br", "cnpj.biz",
    # Domínios genéricos que não servem
    "wixsite.com", "wordpress.com", "blogspot.com",
)


def _is_official_website(url: str, lead_name: str) -> bool:
    """Decide se um link na SERP parece o site OFICIAL do negócio.

    Heurística (todos precisam bater):
      1. Não é rede social/agregador/maps (NON_WEBSITE_HOSTS).
      2. É um domínio raiz/quase-raiz (path curto), não uma página interna
         num site de terceiros.
      3. O domínio carrega pelo menos um pedaço do nome do negócio
         (cruza com slug do nome, ignorando palavras genéricas).
    """
    low = url.lower()
    if any(h in low for h in NON_WEBSITE_HOSTS):
        return False
    # Extrai o host (sem protocolo nem path)
    host = low.split("//", 1)[-1].split("/", 1)[0].split("?", 1)[0]
    if host.startswith("www."):
        host = host[4:]  # ignora prefixo www. p/ pegar o domínio real
    if not host or "." not in host:
        return False
    # Slug do nome: só letras minúsculas, ignora artigos e palavras genéricas
    GENERIC = {"de", "do", "da", "dos", "das", "e", "&", "associados", "advogados",
               "advocacia", "studio", "salao", "clinica", "consultorio",
               "instituto", "centro", "espaco", "ateliê", "atelie", "casa", "vila", "ltda"}
    base = re.sub(r"[^a-z0-9 ]", "", lead_name.lower())
    tokens = [t for t in base.split() if t and t not in GENERIC and len(t) >= 3]
    if not tokens:
        return False
    host_clean = re.sub(r"[^a-z0-9]", "", host.split(".", 1)[0])
    return any(t in host_clean for t in tokens)


def _decode_links(html: str) -> list[str]:
    links = []
    for m in HREF_RE.finditer(html):
        url = unescape(m.group(1))  # &amp; -> &
        if "duckduckgo.com" not in url.lower():
            links.append(url)
    return links


def _first_social(links: list[str], domain: str, bad: tuple[str, ...]) -> str | None:
    for url in links:
        low = url.lower()
        if domain in low and not any(b in low for b in bad):
            return url.split("?")[0].rstrip("/")
    return None


# Sinal de atividade no Instagram, SEM request extra: o snippet do resultado
# na SERP já traz "N Followers/seguidores". Honestidade sobre o limite: nem
# toda SERP traz o número — quando não traz, fica None (não é zero).
def _parse_count(num: str, suf: str | None) -> int | None:
    num = num.strip()
    try:
        if suf:  # "12.3K" / "1,2 mil" / "1M"
            v = float(num.replace(".", "").replace(",", ".")) if "," in num else float(num)
            return int(v * (1_000_000 if suf.lower() == "m" else 1000))
        return int(re.sub(r"[.,]", "", num))  # "1.234" / "1,234" / "829"
    except ValueError:
        return None


def _ig_followers(html: str) -> int | None:
    for m in FOLLOWERS_RE.finditer(html):
        n = _parse_count(m.group(1), m.group(2))
        if n is not None and 0 < n < 50_000_000:  # sanidade
            return n
    return None


def _first_email(html: str) -> str | None:
    for e in EMAIL_RE.findall(html):
        low = e.lower()
        if not low.endswith(EMAIL_BLOCK) and not any(b in low for b in DOMAIN_BLOCK):
            return e
    return None


# ── Enriquecimento por CNPJ (BrasilAPI, dados públicos da Receita) ──────────
# Acha o CNPJ na SERP ("nome cidade CNPJ" aparece em cnpj.biz/econodata etc.),
# consulta a BrasilAPI e devolve: sócio-administrador (abordagem nominal ao
# DONO converte mais), idade da empresa, porte e situação cadastral.

def _norm_txt(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _same_business(lead_name: str, razao: str) -> bool:
    """Só aceita o CNPJ se razão social/fantasia compartilhar um token (>=4
    letras) com o nome do lead — evita casar com empresa homônima errada."""
    tok = lambda s: {t for t in re.sub(r"[^a-z0-9 ]", " ", _norm_txt(s)).split() if len(t) >= 4}
    return bool(tok(lead_name) & tok(razao))


async def _cnpj_lookup(client: httpx.AsyncClient, name: str, city: str, out: dict) -> None:
    html = await _serp(client, f'"{name}" {city} CNPJ')
    tried = set()
    for m in CNPJ_RE.finditer(html):
        digits = re.sub(r"\D", "", m.group(0))
        if len(digits) != 14 or digits in tried:
            continue
        tried.add(digits)
        if len(tried) > 3:  # no máx. 3 candidatos — tempo limitado
            break
        r = await client.get(BRASILAPI_CNPJ + digits, headers=UA)
        if r.status_code != 200:
            continue
        data = r.json()
        razao = f"{data.get('razao_social') or ''} {data.get('nome_fantasia') or ''}"
        if not _same_business(name, razao):
            continue  # CNPJ de outra empresa que apareceu na mesma página
        qsa = data.get("qsa") or []
        socio = next((s.get("nome_socio") for s in qsa if s.get("nome_socio")), None)
        opened = data.get("data_inicio_atividade") or ""
        try:
            age = max(0, date.today().year - int(opened[:4]))
        except (ValueError, TypeError):
            age = None
        out.update({
            "cnpj": digits,
            "razaoSocial": data.get("razao_social"),
            "ownerName": socio.title() if socio else None,
            "companyAge": age,
            "porte": data.get("porte") or data.get("descricao_porte"),
            "cnpjActive": (data.get("descricao_situacao_cadastral") or "").upper() == "ATIVA",
        })
        return


async def _serp(client: httpx.AsyncClient, query: str) -> str:
    r = await client.post(DDG, data={"q": query}, headers=UA)
    # 403/429/CAPTCHA = bloqueio do DDG. Sem este check, o HTML de erro seria
    # parseado normalmente e o lead viraria um falso "not_found" permanente.
    r.raise_for_status()
    return r.text


def _base(lead: dict, partial: bool = False) -> dict:
    """Esqueleto do resultado — ÚNICA fonte das chaves (evita drift entre o
    caminho feliz e os fallbacks de erro/timeout)."""
    return {
        "email": None, "instagram": None, "facebook": None, "linkedin": None,
        "whatsapp": lead.get("phone") or None, "confidence": 0.0, "partial": partial,
        "discoveredWebsite": None,  # site oficial achado na SERP (rebaixa o lead)
        "cnpj": None, "razaoSocial": None, "ownerName": None,
        "companyAge": None, "porte": None, "cnpjActive": None,
        "igFollowers": None,  # seguidores (do snippet da SERP; None = não veio)
        "mobilePhone": None,  # celular achado na web (o OSM costuma dar só o fixo)
    }


async def _enrich(lead: dict) -> dict:
    name, city = lead.get("name", ""), lead.get("city", "")
    out = _base(lead)
    async with httpx.AsyncClient(timeout=6, follow_redirects=True) as client:
        # Caminho quente: 1 consulta, extrai tudo
        html = await _serp(client, f'"{name}" {city}')
        links = _decode_links(html)
        out["instagram"] = _first_social(links, "instagram.com", ("/p/", "/reel/", "/explore", "/accounts"))
        out["facebook"] = _first_social(links, "facebook.com", ("/sharer", "/tr?", "/events", "/groups"))
        out["linkedin"] = _first_social(links, "linkedin.com", ("/posts/", "/feed/"))
        out["email"] = _first_email(html)
        out["mobilePhone"] = _first_mobile(html)
        if out["instagram"]:
            out["igFollowers"] = _ig_followers(html)
        # Pega o 1º link que pareça o site OFICIAL do negócio (corrige o falso
        # positivo do OSM, em que a tag `website` não foi preenchida).
        for url in links:
            if _is_official_website(url, name):
                out["discoveredWebsite"] = url.split("?")[0].rstrip("/")
                break

        # 2ª consulta se faltou e-mail OU celular — este último é o que decide
        # se dá pra abordar por WhatsApp, então vale a busca extra. Falha aqui
        # não descarta o que a 1ª consulta já achou.
        if not out["email"] or not out["mobilePhone"]:
            try:
                html2 = await _serp(client, f'"{name}" {city} whatsapp contato')
                out["email"] = out["email"] or _first_email(html2)
                out["mobilePhone"] = out["mobilePhone"] or _first_mobile(html2)
            except httpx.HTTPError:
                out["partial"] = True

        # Etapa CNPJ com sub-orçamento próprio: se estourar/falhar, os contatos
        # já achados acima são preservados.
        try:
            await asyncio.wait_for(_cnpj_lookup(client, name, city, out), timeout=TIMEOUT_CNPJ)
        except (asyncio.TimeoutError, httpx.HTTPError, ValueError):
            pass

    found = sum(1 for k in ("email", "instagram", "facebook", "linkedin") if out[k])
    out["confidence"] = round(min(1.0, 0.55 + 0.15 * found), 2) if found else 0.0
    return out


def enrich_sync(lead: dict) -> dict:
    async def runner():
        try:
            return await asyncio.wait_for(_enrich(lead), timeout=TIMEOUT_LEAD)
        except (asyncio.TimeoutError, httpx.HTTPError):
            return _base(lead, partial=True)

    return asyncio.run(runner())


if __name__ == "__main__":
    try:
        lead = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {"name": "Studio Aurora", "city": "São Paulo"}
    except (json.JSONDecodeError, IndexError):
        lead = {"name": sys.argv[1] if len(sys.argv) > 1 else "Studio Aurora", "city": "São Paulo"}

    try:
        result = enrich_sync(lead)
    except Exception:  # nunca derruba o processo — o Node depende do JSON
        result = _base(lead, partial=True)

    # ensure_ascii evita qualquer problema de encoding no stdout do Windows
    sys.stdout.write(json.dumps(result, ensure_ascii=True))

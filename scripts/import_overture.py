#!/usr/bin/env python3
"""Gera o SQL que carrega na tabela osm_places os comércios do Overture Maps de uma região.

O Overture é aberto, gratuito, sem chave e atualizado todo mês (boa parte vem de
páginas do Facebook), então traz telefones mais novos que o OSM. As linhas entram
com id "overture/<uuid>" e convivem com as do OSM: a busca do bot não muda.

    pip install duckdb
    python3 scripts/import_overture.py | psql "$DATABASE_URL" -v ON_ERROR_STOP=1

Rode de novo a cada release (mensal) para atualizar. Dados: © Overture Maps Foundation.
"""
import argparse
import csv
import json
import re
import sys
import unicodedata

import duckdb

# shortcut: só o RS, onde estão as cidades do bot; ampliar o bbox se o bot mudar de estado.
RS_BBOX = (-57.7, -33.8, -49.6, -27.0)  # xmin, ymin, xmax, ymax

# Categoria do Overture (taxonomy.primary) -> tags OSM que o osmProvider já entende.
# Ordem importa: o primeiro radical que casa vence.
CATEGORY_TAGS = [
    (("dent", "orthodont", "endodont"), ["amenity=dentist"]),
    (("physical_therapy", "rehabilitation", "occupational_therapy", "speech_therapy"), ["healthcare=physiotherapist"]),
    (("psycholog", "psychotherap", "counseling", "psychiatr", "mental_health"), ["healthcare=psychotherapist"]),
    (("nutrition", "dietit"), ["healthcare=nutrition"]),
    (("barber", "hair", "nail", "beauty", "makeup", "skin_care", "laser_hair", "eyebrow", "spa", "massage"), ["shop=beauty", "shop=hairdresser"]),
    (("gym", "fitness", "pilates", "yoga", "crossfit", "dance_studio"), ["leisure=fitness_centre"]),
    (("doctor", "clinic", "medical", "pediatric"), ["amenity=clinic", "amenity=doctors"]),
]

# Perfil social ou atalho de WhatsApp não é site: quem só tem isso é lead.
NOT_A_SITE = re.compile(r"//(www\.)?(instagram\.com|facebook\.com|fb\.com|linktr\.ee|wa\.me|api\.whatsapp\.com|bit\.ly|tiktok\.com|beacons\.ai)(/|$)", re.I)


def normalize(text):
    decomposed = unicodedata.normalize("NFD", text or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def pg_array(values):
    quoted = (re.sub(r'(["\\])', r"\\\1", v) for v in values)
    return "{" + ",".join(f'"{v}"' for v in quoted) + "}"


def osm_tags(category):
    cat = (category or "").lower()
    for keys, tags in CATEGORY_TAGS:
        if any(k in cat for k in keys):
            return tags
    return ["shop=yes"]  # genérico: ainda casa pela busca por nome


def real_site(websites):
    return next((w for w in websites or [] if w and not NOT_A_SITE.search(w)), None)


def to_row(r):
    """Linha da tabela, ou None se faltar nome ou o lugar estiver fechado."""
    uid, lng, lat, name, category, phones, websites, address, city, status = r
    if not name or status == "permanently_closed":
        return None
    tags = osm_tags(category)
    categories = []
    for tag in tags:
        categories += [tag.split("=")[0], tag]
    props = {"name": name}
    if phones:
        props["phone"] = phones[0]
    site = real_site(websites)
    if site:
        props["website"] = site
    if address:
        props["addr:street"] = address
    if city:
        props["addr:city"] = city
    return [f"overture/{uid}", f"{lat:.6f}", f"{lng:.6f}", normalize(name), pg_array(categories),
            json.dumps(props, ensure_ascii=False, separators=(",", ":"))]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--release", help="ex.: 2026-11-18.0 (padrão: o mais recente)")
    parser.add_argument("--min-confidence", type=float, default=0.6)
    args = parser.parse_args()

    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    base = "s3://overturemaps-us-west-2/release"
    release = args.release or con.sql(
        f"SELECT max(split_part(file, '/', 5)) FROM glob('{base}/*/theme=places/type=place/part-00000*')"
    ).fetchall()[0][0]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", release or ""):
        parser.error(f"release inválido: {release!r}")
    print(f"Overture {release}...", file=sys.stderr)

    xmin, ymin, xmax, ymax = RS_BBOX
    rows = con.execute(
        f"""SELECT id, (bbox.xmin + bbox.xmax) / 2, (bbox.ymin + bbox.ymax) / 2, names.primary,
                   taxonomy.primary, phones, websites, addresses[1].freeform, addresses[1].locality, operating_status
            FROM read_parquet('{base}/{release}/theme=places/type=place/*', hive_partitioning=1)
            WHERE bbox.xmin BETWEEN ? AND ? AND bbox.ymin BETWEEN ? AND ? AND confidence >= ?""",
        [xmin, xmax, ymin, ymax, args.min_confidence],
    ).fetchall()

    out = sys.stdout
    out.write(
        "CREATE TEMP TABLE overture_new (LIKE osm_places);\n"
        "COPY overture_new (id, lat, lng, name_norm, tags, props) FROM STDIN WITH (FORMAT csv);\n"
    )
    writer = csv.writer(out, lineterminator="\n")
    count = 0
    for r in rows:
        row = to_row(r)
        if row:
            writer.writerow(row)
            count += 1
    # Troca só as linhas do Overture, numa transação: a busca nunca vê a tabela pela metade.
    out.write(
        "\\.\n"
        "BEGIN;\n"
        "DELETE FROM osm_places WHERE id LIKE 'overture/%';\n"
        "INSERT INTO osm_places SELECT * FROM overture_new;\n"
        "COMMIT;\n"
        "ANALYZE osm_places;\n"
    )
    print(f"Total: {count} estabelecimentos.", file=sys.stderr)


if __name__ == "__main__":
    main()

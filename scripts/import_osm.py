#!/usr/bin/env python3
"""Gera, a partir de um extrato .osm.pbf, o SQL que carrega a tabela osm_places.

Assim a busca roda no Postgres, sem depender do Overpass público:

    pip install osmium
    curl -LO https://download.geofabrik.de/south-america/brazil-latest.osm.pbf
    python3 scripts/import_osm.py brazil-latest.osm.pbf | psql "$DATABASE_URL" -v ON_ERROR_STOP=1

Conectado como superusuário, use --role captacao_app para o app ser o dono.
A busca segue funcionando durante a carga: a tabela só é trocada no final.
Repita de tempos em tempos para atualizar. Dados: © OpenStreetMap (ODbL).
"""
import argparse
import csv
import json
import os
import re
import sys
import tempfile
import unicodedata

import osmium

COMMERCIAL_KEYS = ("shop", "amenity", "office", "craft", "healthcare", "leisure", "tourism")
PHONE_KEYS = ("phone", "contact:phone", "contact:mobile")
KEEP = (
    "name", "name:pt", "brand",
    "addr:street", "addr:housenumber", "addr:suburb", "addr:neighbourhood",
    "addr:district", "addr:city", "addr:town",
    *PHONE_KEYS,
    "website", "contact:website", "url", "website:official", "contact:url",
)


def normalize(text):
    decomposed = unicodedata.normalize("NFD", text or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def pg_array(values):
    quoted = (re.sub(r'(["\\])', r"\\\1", v) for v in values)
    return "{" + ",".join(f'"{v}"' for v in quoted) + "}"


def to_row(obj):
    """Linha da tabela, ou None se o objeto não for um estabelecimento com nome."""
    tags = {t.k: t.v for t in obj.tags}
    name = tags.get("name") or tags.get("name:pt") or tags.get("brand")
    if not name:
        return None
    categories = []
    for key in COMMERCIAL_KEYS:
        if key in tags:
            categories += [key, f"{key}={tags[key]}"]
    if not categories and not any(k in tags for k in PHONE_KEYS):
        return None

    if obj.is_node():
        if not obj.location.valid():
            return None
        osm_id, lat, lng = f"node/{obj.id}", obj.location.lat, obj.location.lon
    else:
        points = [n.location for n in obj.nodes if n.location.valid()]
        if not points:
            return None
        osm_id = f"way/{obj.id}"
        lat = sum(p.lat for p in points) / len(points)
        lng = sum(p.lon for p in points) / len(points)

    props = {k: tags[k] for k in KEEP if k in tags}
    return [osm_id, f"{lat:.6f}", f"{lng:.6f}", normalize(name), pg_array(categories),
            json.dumps(props, ensure_ascii=False, separators=(",", ":"))]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("pbf")
    parser.add_argument("--role", help="SET ROLE antes de criar a tabela")
    args = parser.parse_args()

    out = sys.stdout
    if args.role:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", args.role):
            parser.error("--role inválido")
        out.write(f"SET ROLE {args.role};\n")
    out.write(
        "DROP TABLE IF EXISTS osm_places_new;\n"
        "CREATE TABLE osm_places_new (id text PRIMARY KEY, lat double precision NOT NULL, "
        "lng double precision NOT NULL, name_norm text NOT NULL, tags text[] NOT NULL, props jsonb NOT NULL);\n"
        "COPY osm_places_new (id, lat, lng, name_norm, tags, props) FROM STDIN WITH (FORMAT csv);\n"
    )
    writer = csv.writer(out, lineterminator="\n")

    count = 0
    # shortcut: relações (multipolígonos) ficam de fora; quase todo negócio é nó ou via.
    entities = osmium.osm.NODE | osmium.osm.WAY
    with tempfile.TemporaryDirectory() as tmp:
        processor = (
            osmium.FileProcessor(args.pbf, entities)
            .with_locations(f"sparse_file_array,{os.path.join(tmp, 'locations.idx')}")
            .with_filter(osmium.filter.KeyFilter(*COMMERCIAL_KEYS, *PHONE_KEYS))
        )
        for obj in processor:
            row = to_row(obj)
            if row:
                writer.writerow(row)
                count += 1
                if count % 100000 == 0:
                    print(f"{count} estabelecimentos...", file=sys.stderr)

    out.write(
        "\\.\n"
        "CREATE INDEX osm_places_new_lat_lng ON osm_places_new (lat, lng);\n"
        "ANALYZE osm_places_new;\n"
        "BEGIN;\n"
        "DROP TABLE IF EXISTS osm_places;\n"
        "ALTER TABLE osm_places_new RENAME TO osm_places;\n"
        "ALTER INDEX osm_places_new_pkey RENAME TO osm_places_pkey;\n"
        "ALTER INDEX osm_places_new_lat_lng RENAME TO osm_places_lat_lng;\n"
        "COMMIT;\n"
    )
    print(f"Total: {count} estabelecimentos.", file=sys.stderr)


if __name__ == "__main__":
    main()

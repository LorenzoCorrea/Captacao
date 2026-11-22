"""Auto-checagem do mapeamento do import_overture (roda sem duckdb instalado)."""
import json
import sys
import types

sys.modules.setdefault("duckdb", types.ModuleType("duckdb"))
from import_overture import osm_tags, real_site, to_row  # noqa: E402

assert osm_tags("physical_therapy") == ["healthcare=physiotherapist"]
assert osm_tags("general_dentistry") == ["amenity=dentist"]
assert osm_tags("barber") == ["shop=beauty", "shop=hairdresser"]
assert osm_tags("pilates_studio") == ["leisure=fitness_centre"]
assert osm_tags("restaurant") == ["shop=yes"]

assert real_site(["https://instagram.com/x", "https://linktr.ee/y"]) is None
assert real_site(["https://wa.me/5555", "https://salao.com.br"]) == "https://salao.com.br"
assert real_site(None) is None

row = to_row(("abc", -53.8, -29.6, "Salão Ána", "hair_salon", ["+5555999999999"], ["https://www.instagram.com/ana"], "Rua A, 1", "Santa Maria", None))
assert row[0] == "overture/abc" and row[3] == "salao ana"
props = json.loads(row[5])
assert "website" not in props and props["phone"] == "+5555999999999"
assert to_row(("x", 0, 0, "Fechado", "gym", None, None, None, None, "permanently_closed")) is None
assert to_row(("x", 0, 0, None, "gym", None, None, None, None, None)) is None
print("ok")

#!/usr/bin/env python3
"""NDVI medio global del catálogo APC (unión de polígonos) → data/apc_ndvi_global.json."""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
GEOJSON = ROOT / "data" / "apc_poligonos.geojson"
OUT = ROOT / "data" / "apc_ndvi_global.json"
API = "https://api-cobertura.imbio.info/api/zone-stats"
YEARS = list(range(2016, 2027))


def fetch_global_stats(geometry: dict) -> dict:
    body = json.dumps(
        {"geometry": geometry, "years": YEARS, "index": "ndvi", "source": "imbio"}
    ).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data


def build_summary(by_year: dict[str, float]) -> dict:
    years = [int(y) for y in sorted(by_year.keys(), key=int)]
    values = [by_year[str(y)] for y in years]
    first_y, last_y = years[0], years[-1]
    first_v, last_v = values[0], values[-1]
    delta = last_v - first_v
    pct = (delta / first_v * 100) if first_v else None
    min_i = min(range(len(values)), key=lambda i: values[i])
    max_i = max(range(len(values)), key=lambda i: values[i])
    return {
        "yearStart": first_y,
        "yearEnd": last_y,
        "ndviStart": round(first_v, 4),
        "ndviEnd": round(last_v, 4),
        "changeAbsolute": round(delta, 4),
        "changePercent": round(pct, 2) if pct is not None else None,
        "minYear": years[min_i],
        "minNdvi": round(values[min_i], 4),
        "maxYear": years[max_i],
        "maxNdvi": round(values[max_i], 4),
    }


def main() -> None:
    geojson = json.loads(GEOJSON.read_text(encoding="utf-8"))
    features = geojson.get("features") or []
    union = unary_union([shape(f["geometry"]) for f in features])
    geometry = mapping(union)
    stats = fetch_global_stats(geometry)
    by_year = stats.get("ndviByYear") or stats.get("valuesByYear") or {}
    by_year = {str(k): float(v) for k, v in by_year.items()}

    payload = {
        "years": YEARS,
        "index": "ndvi",
        "source": "imbio",
        "scope": "Catálogo APC completo (unión de 739 polígonos)",
        "poligonos": len(features),
        "areaHectareas": round(float(stats.get("areaHectares") or 0), 2),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "ndviByYear": by_year,
        "resumen": build_summary(by_year),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK {OUT}")
    print(json.dumps(payload["resumen"], indent=2))


if __name__ == "__main__":
    main()

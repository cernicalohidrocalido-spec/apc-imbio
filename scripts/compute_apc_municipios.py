#!/usr/bin/env python3
"""Agrega resumen municipal a apc_meta.json y opcionalmente NDVI por municipio."""

from __future__ import annotations

import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
from shapely.geometry import mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
APC_GEOJSON = ROOT / "data" / "apc_poligonos.geojson"
META_JSON = ROOT / "data" / "apc_meta.json"
NDVI_MUN_JSON = ROOT / "data" / "apc_ndvi_municipios.json"
API = "https://api-cobertura.imbio.info/api/zone-stats"
NDVI_YEARS = list(range(2016, 2027))
COMPARE_YEARS = [2016, 2026]


def aggregate_municipios(gdf: gpd.GeoDataFrame) -> dict:
    out: dict[str, dict] = {}
    for municipio, grp in gdf.groupby("municipio"):
        if not municipio:
            continue
        ha = grp["hectareas"].astype(float)
        prim = grp.loc[grp["estado_conservacion"] == "PRIMARIO", "hectareas"].sum()
        sec = grp.loc[grp["estado_conservacion"] == "SECUNDARIO", "hectareas"].sum()
        out[str(municipio)] = {
            "poligonos": int(len(grp)),
            "hectareas": round(float(ha.sum()), 2),
            "primario": round(float(prim), 2),
            "secundario": round(float(sec), 2),
            "carbono_absorbido": round(float(grp["carbono_absorbido"].sum()), 2),
        }
    return dict(sorted(out.items(), key=lambda x: x[1]["hectareas"], reverse=True))


def build_summary(by_year: dict[str, float]) -> dict:
    years = [int(y) for y in sorted(by_year.keys(), key=int)]
    values = [by_year[str(y)] for y in years]
    first_v, last_v = values[0], values[-1]
    delta = last_v - first_v
    pct = (delta / first_v * 100) if first_v else None
    min_i = min(range(len(values)), key=lambda i: values[i])
    max_i = max(range(len(values)), key=lambda i: values[i])
    return {
        "ndvi2016": round(by_year.get("2016", values[0]), 4),
        "ndvi2026": round(by_year.get("2026", values[-1]), 4),
        "changeAbsolute": round(last_v - first_v, 4),
        "changePercent": round(pct, 2) if pct is not None else None,
        "minYear": years[min_i],
        "minNdvi": round(values[min_i], 4),
        "maxYear": years[max_i],
        "maxNdvi": round(values[max_i], 4),
    }


def fetch_ndvi(geometry: dict) -> dict:
    body = json.dumps(
        {"geometry": geometry, "years": NDVI_YEARS, "index": "ndvi", "source": "imbio"}
    ).encode("utf-8")
    req = urllib.request.Request(
        API, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data


def ndvi_por_municipio(gdf: gpd.GeoDataFrame) -> dict:
    by_mun: dict[str, dict] = {}

    def task(municipio: str, grp: gpd.GeoDataFrame) -> tuple[str, dict]:
        union = unary_union(grp.geometry.tolist())
        stats = fetch_ndvi(mapping(union))
        by_year = stats.get("ndviByYear") or stats.get("valuesByYear") or {}
        by_year = {str(k): float(v) for k, v in by_year.items()}
        return municipio, {
            "poligonos": int(len(grp)),
            "hectareas": round(float(grp["hectareas"].sum()), 2),
            "areaHectareas": round(float(stats.get("areaHectares") or grp["hectareas"].sum()), 2),
            "ndviByYear": by_year,
            "resumen": build_summary(by_year),
        }

    groups = [(m, grp) for m, grp in gdf.groupby("municipio") if m]
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(task, m, grp): m for m, grp in groups}
        for fut in as_completed(futures):
            municipio = futures[fut]
            try:
                name, payload = fut.result()
                by_mun[name] = payload
                print(f"OK NDVI {name}")
            except Exception as exc:  # noqa: BLE001
                print(f"ERR NDVI {municipio}: {exc}")
                by_mun[municipio] = {"error": str(exc)}

    return dict(sorted(by_mun.items(), key=lambda x: x[1].get("hectareas", 0), reverse=True))


def main() -> None:
    gdf = gpd.read_file(APC_GEOJSON)
    municipios = aggregate_municipios(gdf)

    meta = json.loads(META_JSON.read_text(encoding="utf-8"))
    meta["municipios"] = municipios
    META_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK {META_JSON} — {len(municipios)} municipios")

    ndvi_data = {
        "years": NDVI_YEARS,
        "compareYears": COMPARE_YEARS,
        "index": "ndvi",
        "source": "imbio",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "byMunicipio": ndvi_por_municipio(gdf),
    }
    NDVI_MUN_JSON.write_text(json.dumps(ndvi_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK {NDVI_MUN_JSON}")


if __name__ == "__main__":
    main()

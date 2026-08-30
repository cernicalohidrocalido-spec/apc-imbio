#!/usr/bin/env python3
"""Convierte APC_2025_KMZ.zip → data/apc_poligonos.geojson + apc_meta.json."""

from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
KMZ_PATH = Path(r"C:\Users\Luis Felipe Lozano\imbio-home\APC_2025_KMZ.zip")
OUT_GEOJSON = ROOT / "data" / "apc_poligonos.geojson"
OUT_META = ROOT / "data" / "apc_meta.json"


def parse_kml_description(html: str) -> dict:
    if not isinstance(html, str):
        return {}
    out: dict = {}
    for key in (
        "TIPO_VGT_1",
        "BIO_AER_1",
        "BIO_SUB_1",
        "ABS_CAR_1",
        "ESTADO_C_1",
        "HECTAREAS",
        "FID",
    ):
        match = re.search(rf"<td>{key}</td>\s*<td>([^<]+)</td>", html, re.I)
        if not match:
            continue
        value: str | float = match.group(1).strip()
        try:
            value = float(value)
        except ValueError:
            pass
        out[key.lower()] = value
    return out


def extract_kml(kmz_path: Path, dest: Path) -> Path:
    with zipfile.ZipFile(kmz_path) as outer:
        inner_bytes = outer.read(outer.namelist()[0])
    inner_kmz = dest / "inner.kmz"
    inner_kmz.write_bytes(inner_bytes)
    with zipfile.ZipFile(inner_kmz) as inner:
        kml = dest / "doc.kml"
        kml.write_bytes(inner.read("doc.kml"))
    return kml


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        kml = extract_kml(KMZ_PATH, Path(tmp))
        gdf = gpd.read_file(kml).to_crs(4326)
        attrs = pd.DataFrame([parse_kml_description(x) for x in gdf["description"]])

        gdf["tipo_vegetacion"] = attrs["tipo_vgt_1"].fillna(gdf["Name"])
        gdf["hectareas"] = attrs["hectareas"]
        gdf["biodiversidad_aerea"] = attrs["bio_aer_1"]
        gdf["biodiversidad_subterranea"] = attrs["bio_sub_1"]
        gdf["carbono_absorbido"] = attrs["abs_car_1"]
        gdf["estado_conservacion"] = attrs["estado_c_1"]
        gdf["geometry"] = gdf.geometry.simplify(0.00005, preserve_topology=True)

        gdf["id"] = [f"apc-{i + 1:04d}" for i in range(len(gdf))]
        gdf["nombre"] = gdf.apply(
            lambda r: f"{r['tipo_vegetacion']} ({r['estado_conservacion']})",
            axis=1,
        )

        cols = [
            "id",
            "nombre",
            "tipo_vegetacion",
            "hectareas",
            "biodiversidad_aerea",
            "biodiversidad_subterranea",
            "carbono_absorbido",
            "estado_conservacion",
            "geometry",
        ]
        gdf[cols].to_file(OUT_GEOJSON, driver="GeoJSON")

    total_ha = round(float(gdf["hectareas"].sum()), 2)
    meta = {
        "titulo": "Catálogo de Áreas Prioritarias para la Conservación del Estado de Aguascalientes",
        "fuente": "Secretaría de Sustentabilidad, Medio Ambiente y Agua (SSMAA) · Ley de Protección Ambiental para el Estado de Aguascalientes · IMBIO",
        "documentos": [
            "APC_FINAL_FINAL.docx",
            "POF_Catalogo_de_áreas_prioritarias_para_la_conservacion_2025.pdf",
        ],
        "totalPoligonos": int(len(gdf)),
        "totalHectareas": total_ha,
        "tiposVegetacion": gdf.groupby("tipo_vegetacion")["hectareas"]
        .sum()
        .sort_values(ascending=False)
        .round(2)
        .to_dict(),
        "estadosConservacion": gdf.groupby("estado_conservacion")["hectareas"]
        .sum()
        .round(2)
        .to_dict(),
        "nota": "Polígonos excluyen ANP decretadas y UGA de protección según metodología de la Secretaría de Sustentabilidad, Medio Ambiente y Agua (SSMAA) conforme a la Ley de Protección Ambiental para el Estado de Aguascalientes.",
    }
    OUT_META.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK {OUT_GEOJSON} ({OUT_GEOJSON.stat().st_size / 1024 / 1024:.1f} MB, {len(gdf)} polígonos)")
    print(f"OK total ha: {total_ha}")
    print(f"OK {OUT_META}")


if __name__ == "__main__":
    main()

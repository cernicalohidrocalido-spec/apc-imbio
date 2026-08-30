#!/usr/bin/env python3
"""Asigna municipio a cada polígono APC (centroide dentro del límite municipal)."""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
APC_GEOJSON = ROOT / "data" / "apc_poligonos.geojson"
MUN_GEOJSON = ROOT / "data" / "municipios.geojson"
FALLBACK_MUN = Path(
    r"C:\Users\Luis Felipe Lozano\imbio-home\mapa-calor-estatal\data\limite_municipal.geojson"
)


def assign_municipios(apc: gpd.GeoDataFrame, mun: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    apc = apc.to_crs(mun.crs)
    projected = apc.to_crs(32613)
    apc["_centroid"] = projected.geometry.centroid.to_crs(mun.crs)
    pts = gpd.GeoDataFrame(apc.drop(columns="geometry"), geometry="_centroid", crs=mun.crs)
    joined = gpd.sjoin(pts, mun[["NOM_MUNIC", "geometry"]], how="left", predicate="within")

    for idx in joined.index[joined["NOM_MUNIC"].isna()]:
        poly = apc.loc[idx, "geometry"]
        candidates = mun[mun.intersects(poly)].copy()
        if candidates.empty:
            continue
        candidates["ia"] = candidates.geometry.intersection(poly).area
        joined.loc[idx, "NOM_MUNIC"] = candidates.sort_values("ia", ascending=False).iloc[0]["NOM_MUNIC"]

    apc["municipio"] = joined["NOM_MUNIC"]
    apc = apc.drop(columns="_centroid", errors="ignore")
    return apc.to_crs(4326)


def main() -> None:
    mun_path = MUN_GEOJSON if MUN_GEOJSON.exists() else FALLBACK_MUN
    apc = gpd.read_file(APC_GEOJSON)
    mun = gpd.read_file(mun_path)
    apc = assign_municipios(apc, mun)
    apc.to_file(APC_GEOJSON, driver="GeoJSON")
    print(f"OK {APC_GEOJSON} — municipios asignados:")
    print(apc["municipio"].value_counts().to_string())


if __name__ == "__main__":
    main()

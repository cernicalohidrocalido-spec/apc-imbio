/** Utilidades NDVI: tiles GCS, estadísticas por polígono vía /api/zone-stats. */

const NDVI_STATS_CACHE_KEY = "anp_ndvi_stats_v1";
const ndviStatsMemory = new Map();

function ndviTileUrl(year) {
  const base = (ANP_CONFIG.staticTiles.bucketUrl || "").replace(/\/$/, "");
  return `${base}/ndvi/${year}/{z}/{x}/{y}.png`;
}

function fmtNdvi(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(3);
}

function formatNdviChange(data) {
  if (!data) return { text: "—", color: "", title: "" };
  if (data.changeKind === "absolute" && data.changeAbsolute != null) {
    const d = Number(data.changeAbsolute);
    const why = data.changeReason === "sign_change"
      ? "La base cruzó cero: el porcentaje no es comparable"
      : "La base está cerca de cero: el porcentaje no es comparable";
    return {
      text: `Δ ${d >= 0 ? "+" : ""}${d.toFixed(3)}`,
      color: d >= 0 ? "#15803d" : "#dc2626",
      title: why,
    };
  }
  if (data.changePercent == null) return { text: "—", color: "", title: "" };
  const change = Number(data.changePercent);
  return {
    text: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
    color: change >= 0 ? "#15803d" : "#dc2626",
    title: "",
  };
}

function ndviValue(data, year) {
  const key = String(year);
  return data?.valuesByYear?.[key] ?? data?.ndviByYear?.[key] ?? null;
}

async function fetchNdviStats(geometry, years) {
  const yearList = years || ANP_CONFIG.compareYears;
  const res = await fetch(`${ANP_CONFIG.tilesApiUrl}/api/zone-stats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geometry, years: yearList, index: "ndvi", source: "imbio" }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(res.status === 504 ? "Tiempo de espera agotado" : `HTTP ${res.status}`);
  }
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function readNdviStatsCache() {
  try {
    const raw = sessionStorage.getItem(NDVI_STATS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeNdviStatsCache(all) {
  try {
    sessionStorage.setItem(NDVI_STATS_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* quota exceeded — memory cache still works */
  }
}

function getCachedAnpStats(anpId) {
  if (ndviStatsMemory.has(anpId)) return ndviStatsMemory.get(anpId);
  const cached = readNdviStatsCache()[anpId];
  if (cached) ndviStatsMemory.set(anpId, cached);
  return cached || null;
}

function setCachedAnpStats(anpId, data) {
  ndviStatsMemory.set(anpId, data);
  const all = readNdviStatsCache();
  all[anpId] = data;
  writeNdviStatsCache(all);
}

async function fetchAnpNdviStats(feature, anpId) {
  const cached = getCachedAnpStats(anpId);
  if (cached) return cached;

  if (!window._anpNdviPreload) {
    window._anpNdviPreload = await fetch("data/anp_ndvi_2016_2026.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  const pre = window._anpNdviPreload?.byId?.[anpId];
  if (pre) {
    setCachedAnpStats(anpId, pre);
    return pre;
  }

  const data = await fetchNdviStats(feature.geometry, ANP_CONFIG.compareYears);
  setCachedAnpStats(anpId, data);
  return data;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function loadAllAnpNdviStats(geojson, onProgress) {
  const features = geojson.features || [];
  const preloaded = await fetch("data/anp_ndvi_2016_2026.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  if (preloaded?.byId) {
    Object.entries(preloaded.byId).forEach(([id, stats]) => setCachedAnpStats(id, stats));
    if (onProgress) onProgress(features.length, features.length);
    return features.map((f) => ({
      feature: f,
      stats: preloaded.byId[f.properties.id] || getCachedAnpStats(f.properties.id),
    }));
  }

  let done = 0;
  const rows = await mapWithConcurrency(features, 3, async (feature) => {
    const id = feature.properties.id;
    let stats = getCachedAnpStats(id);
    if (!stats) {
      try {
        stats = await fetchAnpNdviStats(feature, id);
      } catch (err) {
        stats = { error: String(err.message || err) };
      }
    }
    done += 1;
    if (onProgress) onProgress(done, features.length);
    return { feature, stats };
  });
  return rows;
}

function createNdviTileLayer(year, opacity, pane) {
  const st = ANP_CONFIG.staticTiles;
  return L.tileLayer(ndviTileUrl(year), {
    opacity: opacity ?? 0.85,
    minZoom: st.minZoom || 7,
    maxNativeZoom: st.maxNativeZoom || 14,
    maxZoom: 19,
    pane: pane || "overlayPane",
    updateWhenIdle: true,
    updateWhenZooming: false,
  });
}

const NDVI_CLIP_PANE = "ndviClipPane";
const ANP_NDVI_CLIP_ID = "anp-ndvi-clip";
const ANP_NDVI_CLIP_PATH_ID = "anp-ndvi-clip-path";

function ensureNdviClipPane(map) {
  if (!map.getPane(NDVI_CLIP_PANE)) {
    map.createPane(NDVI_CLIP_PANE);
    map.getPane(NDVI_CLIP_PANE).style.zIndex = "260";
  }
}

function ensureAnpNdviClipSvg() {
  if (document.getElementById(ANP_NDVI_CLIP_PATH_ID)) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML =
    `<clipPath id="${ANP_NDVI_CLIP_ID}" clipPathUnits="userSpaceOnUse">`
    + `<path id="${ANP_NDVI_CLIP_PATH_ID}"></path></clipPath>`;
  document.body.appendChild(svg);
}

function ringToClipPathD(map, ring) {
  return ring.map((ll, i) => {
    const p = map.latLngToLayerPoint(ll);
    return `${i === 0 ? "M" : "L"}${p.x},${p.y}`;
  }).join(" ") + " Z";
}

function ringsToClipPathD(map, rings) {
  return rings
    .filter((ring) => ring && ring.length >= 3)
    .map((ring) => ringToClipPathD(map, ring))
    .join(" ");
}

function updateNdviClipPath(map, rings, active) {
  const pane = map.getPane(NDVI_CLIP_PANE);
  if (!pane) return;

  const apply = () => {
    if (!active || !rings?.length) {
      const path = document.getElementById(ANP_NDVI_CLIP_PATH_ID);
      if (path) path.setAttribute("d", "");
      pane.style.clipPath = "";
      return;
    }
    ensureAnpNdviClipSvg();
    const path = document.getElementById(ANP_NDVI_CLIP_PATH_ID);
    if (!path) return;
    path.setAttribute("d", ringsToClipPathD(map, rings));
    pane.style.clipPath = `url(#${ANP_NDVI_CLIP_ID})`;
  };

  if (map._loaded) apply();
  else map.whenReady(apply);
}

function geometryToRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return [geometry.coordinates[0].map((c) => L.latLng(c[1], c[0]))];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((poly) => poly[0].map((c) => L.latLng(c[1], c[0])));
  }
  return [];
}

function featureToRings(feature) {
  return geometryToRings(feature?.geometry);
}

function featuresToRings(features) {
  return (features || []).flatMap((f) => geometryToRings(f.geometry));
}

/** Capa NDVI recortada a uno o varios polígonos GeoJSON. */
function createClippedNdviController(map, options = {}) {
  let year = options.year ?? ANP_CONFIG.compareYears[ANP_CONFIG.compareYears.length - 1];
  let opacity = options.opacity ?? 0.85;
  let visible = Boolean(options.visible);
  let rings = options.rings || [];
  let layer = null;

  ensureNdviClipPane(map);

  const refreshClip = () => updateNdviClipPath(map, rings, visible);

  function syncLayer() {
    if (layer) map.removeLayer(layer);
    layer = createNdviTileLayer(year, opacity, NDVI_CLIP_PANE);
    if (visible) layer.addTo(map);
    refreshClip();
  }

  const onMapChange = () => refreshClip();
  map.on("move zoom viewreset resize", onMapChange);
  syncLayer();

  return {
    setRings(newRings) {
      rings = newRings || [];
      refreshClip();
    },
    setFeature(feature) {
      this.setRings(featureToRings(feature));
    },
    setFeatures(features) {
      this.setRings(featuresToRings(features));
    },
    setYear(y) {
      year = y;
      syncLayer();
    },
    getYear() {
      return year;
    },
    setOpacity(o) {
      opacity = o;
      if (layer) layer.setOpacity(o);
    },
    setVisible(on) {
      visible = Boolean(on);
      if (!layer) syncLayer();
      else if (visible) layer.addTo(map);
      else map.removeLayer(layer);
      refreshClip();
    },
    isVisible() {
      return visible;
    },
    destroy() {
      map.off("move zoom viewreset resize", onMapChange);
      if (layer) map.removeLayer(layer);
      layer = null;
      updateNdviClipPath(map, [], false);
    },
  };
}

function ndviPointPopupHtml(latlng, data, error) {
  const coord = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  if (error) {
    return `<div class="ndvi-point-popup"><div class="ndvi-point-status">${error}</div><div class="ndvi-point-coord">${coord}</div></div>`;
  }
  if (!data) {
    return `<div class="ndvi-point-popup"><div class="ndvi-point-status">Consultando NDVI…</div><div class="ndvi-point-coord">${coord}</div></div>`;
  }
  const val = data?.imbio?.value ?? data?.imbio?.ndvi;
  const yr = data?.imbio?.year ?? "";
  const partial = data?.imbio?.partial ? ' <span class="ndvi-point-note">(parcial)</span>' : "";
  return `<div class="ndvi-point-popup">
    <div class="ndvi-point-row"><span>NDVI IMBIO ${yr}${partial}</span><b>${fmtNdvi(val)}</b></div>
    <div class="ndvi-point-coord">${coord}</div>
  </div>`;
}

function queryNdviAtPoint(map, latlng, year) {
  const popup = L.popup({ className: "ndvi-point-leaflet", maxWidth: 280, autoPan: true })
    .setLatLng(latlng)
    .setContent(ndviPointPopupHtml(latlng, null))
    .openOn(map);

  const params = new URLSearchParams({
    lat: latlng.lat.toFixed(6),
    lng: latlng.lng.toFixed(6),
    imbio: String(year),
    index: "ndvi",
  });

  fetch(`${ANP_CONFIG.tilesApiUrl}/api/ndvi-point?${params}`)
    .then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      popup.setContent(ndviPointPopupHtml(latlng, body));
    })
    .catch((err) => {
      popup.setContent(ndviPointPopupHtml(latlng, null, err.message || "No se pudo leer el NDVI."));
    });
}

function syncNdviIdentifyCursor(map, enabled) {
  map.getContainer().classList.toggle("ndvi-identify-on", Boolean(enabled));
}

function bindNdviPointIdentify(map, options) {
  const getYear = options.getYear || (() => ANP_CONFIG.compareYears[1]);
  const isEnabled = options.isEnabled || (() => false);

  const refreshCursor = () => syncNdviIdentifyCursor(map, isEnabled());
  map.on("click", (event) => {
    if (!isEnabled()) return;
    queryNdviAtPoint(map, event.latlng, getYear());
  });

  return { refreshCursor };
}

function renderNdviLegend(container, year) {
  const leg = ANP_CONFIG.ndviLegend;
  if (!container || !leg) return;
  const yearLabel = year ? ` · ${year}` : "";
  container.innerHTML = `
    <div class="ndvi-legend-title">NDVI${yearLabel}</div>
    <div class="ndvi-legend-body">
      <div class="ndvi-legend-bar" style="background:${leg.bar}"></div>
      <div class="ndvi-legend-labels">
        ${leg.labels.map((l) => `<div><strong>${l.v}</strong>${l.t}</div>`).join("")}
      </div>
    </div>
  `;
}

function updateNdviLegendYear(container, year) {
  const title = container?.querySelector(".ndvi-legend-title");
  if (title) title.textContent = `NDVI · ${year}`;
}

function setNdviLegendVisible(container, visible) {
  if (!container) return;
  container.hidden = !visible;
}

function ndviStatsHtml(stats, years) {
  const ys = years || ANP_CONFIG.compareYears;
  const first = ndviValue(stats, ys[0]);
  const last = ndviValue(stats, ys[ys.length - 1]);
  const ch = formatNdviChange(stats);
  if (stats?.error) {
    return `<div class="ndvi-stats ndvi-stats-error">${stats.error}</div>`;
  }
  return `
    <div class="ndvi-stats">
      <div class="ndvi-stats-title">Cobertura vegetal (NDVI medio)</div>
      <div class="ndvi-stat-row"><span>${ys[0]}</span><strong>${fmtNdvi(first)}</strong></div>
      <div class="ndvi-stat-row"><span>${ys[ys.length - 1]}</span><strong>${fmtNdvi(last)}</strong></div>
      <div class="ndvi-stat-row ndvi-stat-change">
        <span>Cambio</span>
        <strong style="color:${ch.color}" title="${ch.title || ""}">${ch.text}</strong>
      </div>
      <div class="ndvi-stats-note">Mediana anual Sentinel-2 · api-cobertura.imbio.info</div>
    </div>
  `;
}

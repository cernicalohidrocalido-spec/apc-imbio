/** Configuración compartida: tiles NDVI y API de estadísticas (cobertura.imbio.info). */
const APC_CONFIG = {
  tilesApiUrl: "https://api-cobertura.imbio.info",
  staticTiles: {
    bucketUrl: "https://storage.googleapis.com/imbio-cobertura-tiles",
    minZoom: 7,
    maxNativeZoom: 14,
  },
  ndviYears: [2016, 2020, 2022, 2024, 2026],
  compareYears: [2016, 2026],
  ndviLegend: {
    bar: "linear-gradient(to top, #ffffff, #ce7e45, #fcd163, #99b718, #207401, #012e01)",
    labels: [
      { v: "0.9", t: "Vegetación densa" },
      { v: "0.5", t: "Mixto" },
      { v: "0.0", t: "Suelo / agua" },
    ],
  },
  anpSiteUrl: "https://anp.imbio.info",
};
const ANP_CONFIG = APC_CONFIG;

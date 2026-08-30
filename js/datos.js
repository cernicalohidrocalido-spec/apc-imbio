// Carga y utilidades compartidas — sitio APC IMBIO

async function cargarANPs() {
  const res = await fetch('data/anps.json');
  return res.json();
}

async function cargarGeoJSON() {
  const res = await fetch('data/anp_poligonos.geojson');
  return res.json();
}

async function cargarAPC() {
  const res = await fetch('data/apc_poligonos.geojson');
  return res.json();
}

async function cargarAPCMeta() {
  const res = await fetch('data/apc_meta.json');
  return res.json();
}

async function cargarMunicipios() {
  const res = await fetch('data/municipios.geojson');
  return res.json();
}

function listaMunicipiosApc(features) {
  return [...new Set(features.map((f) => f.properties.municipio).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
}

function estiloANP() {
  return { color: '#2d6a4f', weight: 2, fillColor: '#52b788', fillOpacity: 0.25 };
}

function estiloAPC(feature) {
  const primario = feature?.properties?.estado_conservacion === 'PRIMARIO';
  return {
    color: primario ? '#3A5A40' : '#0B3D75',
    weight: 2,
    dashArray: '6 4',
    fillColor: primario ? '#2f8f5b' : '#aecbe6',
    fillOpacity: primario ? 0.38 : 0.32,
  };
}

function tituloVegetacion(tipo) {
  if (!tipo) return '—';
  return tipo.charAt(0) + tipo.slice(1).toLowerCase();
}

function apcBadgeClass(estado) {
  return estado === 'PRIMARIO' ? 'badge-apc-primario' : 'badge-apc-secundario';
}

function apcEstadoLabel(estado) {
  return estado === 'PRIMARIO' ? 'Vegetación primaria' : 'Vegetación secundaria';
}

function biomasaAerea(props) {
  return props?.biomasa_aerea ?? props?.biodiversidad_aerea;
}

function biomasaSubterranea(props) {
  return props?.biomasa_subterranea ?? props?.biodiversidad_subterranea;
}

function popupAPCHtml(props, statsBlock) {
  const veg = tituloVegetacion(props.tipo_vegetacion);
  const estado = props.estado_conservacion === 'PRIMARIO' ? 'Primario' : 'Secundario';
  const stats = statsBlock ? `<br>${statsBlock}` : '';
  const ba = biomasaAerea(props);
  const bs = biomasaSubterranea(props);
  return `<b>Catálogo APC · Área prioritaria</b><br>
    <span style="color:var(--texto-suave);font-size:0.9em">${veg} · ${estado}${props.municipio ? ` · ${props.municipio}` : ''}</span><br>
    ${formatoHectareas(props.hectareas)}<br>
    <small>Biomasa aérea: ${ba?.toFixed(1) ?? '—'} t C · Subterránea: ${bs?.toFixed(1) ?? '—'} t C<br>
    Carbono absorbido: ${props.carbono_absorbido?.toFixed(1) ?? '—'} t CO₂e</small>${stats}
    <a class="popup-link" href="ficha-apc.html?id=${props.id}">Ver ficha completa →</a>`;
}

function popupANPHtml(props) {
  return `<b>${props.nombre}</b> <span style="color:var(--texto-suave);font-size:0.85em">(ANP)</span><br>
    ${formatoHectareas(props.hectareas)}<br>
    <a class="popup-link" href="${APC_CONFIG.anpSiteUrl}/ficha.html?id=${props.id}" target="_blank" rel="noopener">Ver ficha SANPEA →</a>`;
}

function formatoHectareas(ha) {
  if (ha === null || ha === undefined) return '—';
  return ha.toLocaleString('es-MX', { maximumFractionDigits: 2 }) + ' ha';
}

function agregarCapasBase(map, colapsado) {
  const calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  });
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  });
  calles.addTo(map);
  L.control.layers({ 'Calles': calles, 'Satélite': satelite }, null, { position: 'topright', collapsed: !!colapsado }).addTo(map);
}

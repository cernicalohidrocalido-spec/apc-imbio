/** Exportación KMZ / Shapefile del corte municipal APC (cliente). */

function slugMunicipio(nombre) {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function apcPropsExport(props) {
  return {
    id: props.id || '',
    nombre: props.nombre || '',
    tipo_vegetacion: props.tipo_vegetacion || '',
    hectareas: Number(props.hectareas) || 0,
    municipio: props.municipio || '',
    estado_cons: props.estado_conservacion || '',
    biomasa_aer: Number(biomasaAerea(props)) || 0,
    biomasa_sub: Number(biomasaSubterranea(props)) || 0,
    carbono_t: Number(props.carbono_absorbido) || 0,
  };
}

function featureCollectionMunicipio(features) {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: apcPropsExport(f.properties),
      geometry: f.geometry,
    })),
  };
}

function ringToKmlCoords(ring) {
  return ring.map(([lon, lat]) => `${lon},${lat},0`).join(' ');
}

function polygonKml(coords) {
  const outer = ringToKmlCoords(coords[0]);
  let holes = '';
  for (let i = 1; i < coords.length; i += 1) {
    holes += `<innerBoundaryIs><LinearRing><coordinates>${ringToKmlCoords(coords[i])}</coordinates></LinearRing></innerBoundaryIs>`;
  }
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs>${holes}</Polygon>`;
}

function geometryToKml(geom) {
  if (geom.type === 'Polygon') return polygonKml(geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    const parts = geom.coordinates.map((poly) => polygonKml(poly)).join('');
    return `<MultiGeometry>${parts}</MultiGeometry>`;
  }
  return '';
}

function estiloKmlApc(props) {
  const primario = props.estado_conservacion === 'PRIMARIO';
  const line = primario ? 'ff405a3a' : 'ff753d0b';
  const fill = primario ? '665b8f2f' : '66e6cbad';
  return `<Style><LineStyle><color>${line}</color><width>2</width></LineStyle><PolyStyle><color>${fill}</color></PolyStyle></Style>`;
}

function buildKmlDocument(municipio, features) {
  const placemarks = features.map((f) => {
    const p = f.properties;
    const veg = tituloVegetacion(p.tipo_vegetacion);
    const desc = [
      `ID: ${p.id}`,
      `Municipio: ${p.municipio}`,
      `Superficie: ${p.hectareas} ha`,
      `Estado: ${p.estado_conservacion}`,
    ].join(' · ');
    return `<Placemark>
<name>${veg} (${p.id})</name>
<description>${desc}</description>
${estiloKmlApc(p)}
${geometryToKml(f.geometry)}
</Placemark>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>APC · ${municipio}</name>
<description>Catálogo de Áreas Prioritarias para la Conservación · ${features.length} polígonos · IMBIO</description>
${placemarks}
</Document>
</kml>`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function descargarKmzMunicipio(municipio, features) {
  if (!window.JSZip) throw new Error('JSZip no disponible');
  const kml = buildKmlDocument(municipio, features);
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, `APC_${slugMunicipio(municipio)}.kmz`);
}

function descargarShpMunicipio(municipio, features) {
  if (!window.shpwrite?.download) throw new Error('shp-write no disponible');
  const fc = featureCollectionMunicipio(features);
  shpwrite.download(fc, {
    file: `APC_${slugMunicipio(municipio)}`,
    types: { polygon: 'apc_poligonos' },
  });
}

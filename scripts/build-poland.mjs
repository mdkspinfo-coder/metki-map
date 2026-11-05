// Одноразовый генератор контура Польши для фильтра 3D-зданий.
// Запуск: node scripts/build-poland.mjs
// Источник: граница Польши из OpenStreetMap (ODbL) через Nominatim.
import { writeFileSync } from 'node:fs';

const THRESHOLD = 0.0008; // ~80 м: упрощение на стороне Nominatim
const url =
  'https://nominatim.openstreetmap.org/lookup?osm_ids=R49715&format=geojson' +
  `&polygon_geojson=1&polygon_threshold=${THRESHOLD}`;

const res = await fetch(url, { headers: { 'User-Agent': 'metki-map-build-script/1.0' } });
if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
const data = await res.json();
const geometry = data.features?.[0]?.geometry;
if (!geometry) throw new Error('Nominatim не вернул геометрию');

const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
const round = (ring) => ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);

const output = {
  source: 'OpenStreetMap relation 49715 (ODbL), Nominatim',
  generated: new Date().toISOString().slice(0, 10),
  precise: {
    type: 'MultiPolygon',
    coordinates: polygons.map((polygon) => polygon.map(round)),
  },
};

writeFileSync('src/shared/poland-boundary.json', JSON.stringify(output));
const vertices = polygons.reduce((sum, p) => sum + p.reduce((s, r) => s + r.length, 0), 0);
console.log(`${polygons.length} полигонов, ${vertices} вершин`);

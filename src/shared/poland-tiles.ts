import { VectorTile } from '@mapbox/vector-tile';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { PbfReader } from 'pbf';
import { pointInRing } from './geo';
import type { Box, Point } from './poland';

const BUILDING_LAYER = 'building';

const lngOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOf = (y: number, z: number) =>
  (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / 2 ** z)) * 180) / Math.PI;

/**
 * Границы участка карты с запасом 5%: дома у края участка хранятся с небольшим заходом
 * за него, и без запаса такие польские дома считались бы лежащими вне контура.
 */
export function tileBox(z: number, x: number, y: number): Box {
  const margin = 0.05;
  return {
    west: lngOf(x - margin, z),
    east: lngOf(x + 1 + margin, z),
    north: latOf(y - margin, z),
    south: latOf(y + 1 + margin, z),
  };
}

/** Координаты точки внутри участка, в единицах векторного тайла. */
function toTileUnits([lng, lat]: Point, z: number, x: number, y: number, extent: number): Point {
  const scale = 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  const mercatorY = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return [(((lng + 180) / 360) * scale - x) * extent, (mercatorY * scale - y) * extent];
}

type Ring = { x: number; y: number }[];

function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += (ring[j].x - ring[i].x) * (ring[i].y + ring[j].y);
  }
  return area;
}

/** Разбирает составной объект на отдельные дома: внешний контур и его внутренние дворы. */
function splitIntoBuildings(rings: Ring[]): Ring[][] {
  const buildings: Ring[][] = [];
  let outerSign = 0;
  for (const ring of rings) {
    const sign = Math.sign(signedArea(ring));
    if (sign === 0) continue;
    if (outerSign === 0) outerSign = sign;
    if (sign === outerSign) buildings.push([ring]);
    else buildings[buildings.length - 1]?.push(ring);
  }
  return buildings;
}

function centerOf(ring: Ring): Point {
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point.x;
    y += point.y;
  }
  return [x / ring.length, y / ring.length];
}

/**
 * Оставляет в участке карты только дома из Польши.
 *
 * Фильтром стиля этого не сделать: в данных карты все дома одной высоты на участке склеены
 * в один объект, до тысячи домов. Фильтр решает за объект целиком, и если хоть один дом
 * склейки стоял в Польше, объёмными становились и дома на другом берегу пограничной реки.
 */
export function keepPolishBuildings(
  data: ArrayBuffer,
  z: number,
  x: number,
  y: number,
  borderRings: Point[][],
): ArrayBuffer {
  const layer = new VectorTile(new PbfReader(new Uint8Array(data))).layers[BUILDING_LAYER];
  if (!layer) return new ArrayBuffer(0);

  const rings = borderRings.map((ring) => ring.map((point) => toTileUnits(point, z, x, y, layer.extent)));
  const inPoland = ([px, py]: Point) => rings.some((ring) => pointInRing(px, py, ring));

  const features = [];
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index);
    const kept = splitIntoBuildings(feature.loadGeometry()).filter((building) =>
      inPoland(centerOf(building[0])),
    );
    if (kept.length > 0) {
      features.push({
        type: 3,
        tags: feature.properties,
        geometry: kept.flat().map((ring) => ring.map((point) => [point.x, point.y])),
      });
    }
  }
  if (features.length === 0) return new ArrayBuffer(0);

  const tile = { features, transformed: true, source: null, x, y, z } as never;
  return fromGeojsonVt({ [BUILDING_LAYER]: tile }, { version: 2, extent: layer.extent }).slice().buffer as ArrayBuffer;
}

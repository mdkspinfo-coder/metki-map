import boundary from './poland-boundary.json';
import { pointInRing, type LatLng } from './geo';

export const POLAND_CENTER: [number, number] = [19.4, 52.1];

export type Point = [number, number];
type Ring = Point[];

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

const RINGS = boundary.precise.coordinates.map((polygon) => polygon[0] as Ring);

export function isInPoland({ lat, lng }: LatLng): boolean {
  return RINGS.some((ring) => pointInRing(lng, lat, ring));
}

/** Пересекает ли отрезок прямоугольник (алгоритм Лианга-Барски). */
function segmentTouchesBox([x1, y1]: Point, [x2, y2]: Point, box: Box): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let from = 0;
  let to = 1;
  const edges: [number, number][] = [
    [-dx, x1 - box.west],
    [dx, box.east - x1],
    [-dy, y1 - box.south],
    [dy, box.north - y1],
  ];
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return false;
    } else {
      const ratio = distance / direction;
      if (direction < 0) from = Math.max(from, ratio);
      else to = Math.min(to, ratio);
      if (from > to) return false;
    }
  }
  return true;
}

/** Обрезает контур по одной стороне прямоугольника (шаг алгоритма Сазерленда-Ходжмана). */
function clipSide(ring: Ring, inside: (p: Point) => boolean, cross: (a: Point, b: Point) => Point): Ring {
  const result: Ring = [];
  for (let i = 0; i < ring.length; i += 1) {
    const current = ring[i];
    const previous = ring[(i + ring.length - 1) % ring.length];
    if (inside(current)) {
      if (!inside(previous)) result.push(cross(previous, current));
      result.push(current);
    } else if (inside(previous)) {
      result.push(cross(previous, current));
    }
  }
  return result;
}

const atX = (x: number) => (a: Point, b: Point): Point => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
const atY = (y: number) => (a: Point, b: Point): Point => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];

function clipRing(ring: Ring, box: Box): Ring {
  // Первая точка контура повторяет последнюю: для обрезки контур нужен незамкнутым.
  let result = ring.slice(0, -1);
  result = clipSide(result, (p) => p[0] >= box.west, atX(box.west));
  result = clipSide(result, (p) => p[0] <= box.east, atX(box.east));
  result = clipSide(result, (p) => p[1] >= box.south, atY(box.south));
  result = clipSide(result, (p) => p[1] <= box.north, atY(box.north));
  return result;
}

export type AreaKind =
  | { kind: 'inside' }
  | { kind: 'outside' }
  /** Участок пересекает граница: rings содержит только её кусок в пределах участка. */
  | { kind: 'border'; rings: Ring[] };

/** Где находится участок карты относительно Польши. */
export function classifyArea(box: Box): AreaKind {
  const rings: Ring[] = [];
  for (const ring of RINGS) {
    const crosses = ring.some((point, index) => index > 0 && segmentTouchesBox(ring[index - 1], point, box));
    if (!crosses) continue;
    const clipped = clipRing(ring, box);
    if (clipped.length >= 3) rings.push([...clipped, clipped[0]]);
  }
  if (rings.length > 0) return { kind: 'border', rings };
  // Граница участок не пересекает: он целиком внутри страны или целиком снаружи.
  const center = { lng: (box.west + box.east) / 2, lat: (box.south + box.north) / 2 };
  return { kind: isInPoland(center) ? 'inside' : 'outside' };
}

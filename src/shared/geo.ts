/** Радиус, в котором метка становится зелёной. */
export const ACTIVATION_RADIUS_M = 200;

/**
 * Запас на выход из радиуса. GPS дрожит на несколько метров, и без запаса метка
 * на самой границе мигала бы вместе с кнопкой жалобы. На вход запас не влияет.
 */
export const DEACTIVATION_MARGIN_M = 20;

/**
 * Хуже этой точности координатам нельзя верить: так определяют по вышкам и Wi-Fi.
 * Порог должен быть заметно меньше радиуса, иначе метка загоралась бы далеко от человека.
 */
export const MAX_USABLE_ACCURACY_M = 75;

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Расстояние по поверхности Земли (формула гаверсинусов). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Какие метки зелёные. Активируются только прошедшие модерацию. */
export function computeActiveIds(
  markers: ReadonlyArray<LatLng & { id: string; status: string }>,
  position: LatLng | null,
  previous: ReadonlySet<string>,
): Set<string> {
  const active = new Set<string>();
  if (!position) return active;
  for (const marker of markers) {
    if (marker.status !== 'approved') continue;
    const limit = ACTIVATION_RADIUS_M + (previous.has(marker.id) ? DEACTIVATION_MARGIN_M : 0);
    if (distanceMeters(position, marker) <= limit) active.add(marker.id);
  }
  return active;
}

export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Телефон иногда вдруг отдаёт грубую координату по вышке вместо спутниковой.
 * Такой скачок сразу после хорошей точки игнорируем, но не дольше 15 секунд:
 * если хороших данных больше нет, лучше грубая точка, чем застывшая.
 */
export function shouldAcceptFix(
  last: { accuracy: number; receivedAt: number } | null,
  next: { accuracy: number; receivedAt: number },
): boolean {
  if (!last) return true;
  const muchWorse = next.accuracy > Math.max(last.accuracy * 3, 50);
  return !muchWorse || next.receivedAt - last.receivedAt >= 15_000;
}

/** Круг на карте как полигон GeoJSON. */
export function circleRing(center: LatLng, radiusM: number, steps = 72): [number, number][] {
  const angular = radiusM / EARTH_RADIUS_M;
  const lat1 = toRad(center.lat);
  const lng1 = toRad(center.lng);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([toDeg(lng2), toDeg(lat2)]);
  }
  return ring;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} м`;
  const km = meters / 1000;
  return `${km.toLocaleString('ru-RU', { maximumFractionDigits: km < 100 ? 1 : 0 })} км`;
}

/** Точка внутри многоугольника (метод лучей). */
export function pointInRing(lng: number, lat: number, ring: ReadonlyArray<readonly number[]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

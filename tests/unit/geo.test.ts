import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_RADIUS_M,
  circleRing,
  computeActiveIds,
  distanceMeters,
  formatDistance,
  pointInRing,
  sameIds,
  shouldAcceptFix,
} from '../../src/shared/geo';

const WARSAW = { lat: 52.2297, lng: 21.0122 };

/** Точка на заданном расстоянии к северу. */
const north = (meters: number) => ({ lat: WARSAW.lat + meters / 111_195, lng: WARSAW.lng });

const marker = (id: string, meters: number, status = 'approved') => ({ id, status, ...north(meters) });

describe('distanceMeters', () => {
  it('считает известное расстояние Варшава - Краков', () => {
    const krakow = { lat: 50.0647, lng: 19.945 };
    expect(distanceMeters(WARSAW, krakow) / 1000).toBeCloseTo(252, 0);
  });

  it('для одной точки равно нулю', () => {
    expect(distanceMeters(WARSAW, WARSAW)).toBe(0);
  });

  it('работает через линию перемены дат', () => {
    expect(distanceMeters({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 })).toBeLessThan(23_000);
  });
});

describe('computeActiveIds', () => {
  it('метка внутри 800 м зелёная, снаружи нет', () => {
    const active = computeActiveIds([marker('near', 799), marker('far', 801)], WARSAW, new Set());
    expect([...active]).toEqual(['near']);
  });

  it('ровно на границе радиуса метка активна', () => {
    const target = marker('edge', 0);
    const exact = { ...target, lat: WARSAW.lat + ACTIVATION_RADIUS_M / 111_195 - 1e-7 };
    expect(computeActiveIds([exact], WARSAW, new Set()).has('edge')).toBe(true);
  });

  it('метка на проверке и отклонённая не активируются', () => {
    const active = computeActiveIds(
      [marker('a', 10, 'pending'), marker('b', 10, 'rejected'), marker('c', 10, 'removed')],
      WARSAW,
      new Set(),
    );
    expect(active.size).toBe(0);
  });

  it('без GPS ничего не активно', () => {
    expect(computeActiveIds([marker('a', 10)], null, new Set(['a'])).size).toBe(0);
  });

  it('дрожание GPS на границе не выключает зелёную метку', () => {
    expect(computeActiveIds([marker('a', 810)], WARSAW, new Set(['a'])).has('a')).toBe(true);
    expect(computeActiveIds([marker('a', 810)], WARSAW, new Set()).has('a')).toBe(false);
  });

  it('за пределами запаса метка гаснет', () => {
    expect(computeActiveIds([marker('a', 825)], WARSAW, new Set(['a'])).has('a')).toBe(false);
  });
});

describe('shouldAcceptFix', () => {
  const good = { accuracy: 8, receivedAt: 100_000 };

  it('принимает первую точку', () => {
    expect(shouldAcceptFix(null, { accuracy: 5000, receivedAt: 0 })).toBe(true);
  });

  it('отбрасывает скачок на грубую координату', () => {
    expect(shouldAcceptFix(good, { accuracy: 1500, receivedAt: 103_000 })).toBe(false);
  });

  it('не отбрасывает обычное ухудшение точности', () => {
    expect(shouldAcceptFix(good, { accuracy: 45, receivedAt: 101_000 })).toBe(true);
  });

  it('принимает грубую точку, если хороших нет 15 секунд', () => {
    expect(shouldAcceptFix(good, { accuracy: 1500, receivedAt: 115_000 })).toBe(true);
  });
});

describe('вспомогательные функции', () => {
  it('sameIds сравнивает наборы', () => {
    expect(sameIds(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameIds(new Set(['a']), new Set(['b']))).toBe(false);
    expect(sameIds(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  });

  it('circleRing строит замкнутый круг нужного радиуса', () => {
    const ring = circleRing(WARSAW, 800);
    expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 8);
    expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 8);
    for (const [lng, lat] of ring) {
      expect(distanceMeters(WARSAW, { lat, lng })).toBeCloseTo(800, 3);
    }
  });

  it('formatDistance показывает метры и километры', () => {
    expect(formatDistance(350.4)).toBe('350 м');
    expect(formatDistance(1234)).toBe('1,2 км');
    expect(formatDistance(250_000)).toBe('250 км');
  });

  it('pointInRing определяет точку в квадрате', () => {
    const square = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(15, 5, square)).toBe(false);
  });
});

import { VectorTile } from '@mapbox/vector-tile';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { PbfReader } from 'pbf';
import { describe, expect, it } from 'vitest';
import { pointInRing } from '../../src/shared/geo';
import { classifyArea, isInPoland, type Box } from '../../src/shared/poland';
import boundary from '../../src/shared/poland-boundary.json';
import { keepPolishBuildings, tileBox } from '../../src/shared/poland-tiles';

const around = (lng: number, lat: number, half = 0.02): Box => ({
  west: lng - half,
  east: lng + half,
  south: lat - half,
  north: lat + half,
});

describe('граница Польши', () => {
  const cities: [string, number, number, boolean][] = [
    ['Варшава', 52.2297, 21.0122, true],
    ['Краков', 50.0647, 19.945, true],
    ['Гданьск', 54.352, 18.6466, true],
    ['Вроцлав', 51.1079, 17.0385, true],
    ['Белосток', 53.1325, 23.1688, true],
    ['Слубице (граница с Германией)', 52.3498, 14.5606, true],
    ['Згожелец (граница с Германией)', 51.1528, 15.0084, true],
    ['Цешин (граница с Чехией)', 49.7486, 18.6358, true],
    ['Берлин', 52.52, 13.405, false],
    ['Франкфурт-на-Одере', 52.3471, 14.5506, false],
    ['Гёрлиц', 51.1526, 14.9872, false],
    ['Rothenburger Straße, Гёрлиц', 51.16555, 14.99709, false],
    ['Чески-Тешин', 49.7461, 18.6262, false],
    ['Прага', 50.0755, 14.4378, false],
    ['Львов', 49.8397, 24.0297, false],
    ['Вильнюс', 54.6872, 25.2797, false],
    ['Калининград', 54.7104, 20.4522, false],
  ];

  for (const [name, lat, lng, expected] of cities) {
    it(`${name}: ${expected ? 'внутри' : 'снаружи'}`, () => {
      expect(isInPoland({ lat, lng })).toBe(expected);
    });
  }
});

describe('где участок карты относительно страны', () => {
  it('в глубине страны проверка не нужна', () => {
    expect(classifyArea(around(21.0122, 52.2297)).kind).toBe('inside');
    expect(classifyArea(around(19.945, 50.0647)).kind).toBe('inside');
  });

  it('за границей участок снаружи, даже совсем рядом с ней', () => {
    expect(classifyArea(around(13.405, 52.52)).kind).toBe('outside');
    expect(classifyArea(around(24.0297, 49.8397)).kind).toBe('outside');
  });

  it('участок на другом конце света не считается Польшей', () => {
    expect(classifyArea(around(-73.98, 40.75)).kind).toBe('outside');
    expect(classifyArea(around(179.99, 0)).kind).toBe('outside');
  });

  it('на границе используется короткий кусок контура, а не вся граница', () => {
    const area = classifyArea(around(15.0, 51.15));
    if (area.kind !== 'border') throw new Error('ожидалась граница');
    const vertices = area.rings.flat().length;
    expect(vertices).toBeGreaterThan(3);
    expect(vertices).toBeLessThan(150);
    expect(area.rings[0][0]).toEqual(area.rings[0][area.rings[0].length - 1]);
  });

  it('вырезанный кусок совпадает с настоящей границей по всему её периметру', () => {
    const perimeter = boundary.precise.coordinates[0][0];
    for (let index = 0; index < perimeter.length; index += 150) {
      const [lng, lat] = perimeter[index];
      const box = around(lng, lat, 0.05);
      const area = classifyArea(box);
      if (area.kind !== 'border') throw new Error(`граница не найдена у ${lng}, ${lat}`);
      for (let i = 1; i < 20; i += 1) {
        for (let j = 1; j < 20; j += 1) {
          const x = box.west + ((box.east - box.west) * i) / 20;
          const y = box.south + ((box.north - box.south) * j) / 20;
          const inClip = area.rings.some((ring) => pointInRing(x, y, ring));
          expect(inClip).toBe(isInPoland({ lat: y, lng: x }));
        }
      }
    }
  });
});

describe('разбор пограничного участка по домам', () => {
  const Z = 14;
  const EXTENT = 4096;
  const worldX = (lng: number) => ((lng + 180) / 360) * 2 ** Z;
  const worldY = (lat: number) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 2 ** Z;
  };

  // Участок z14 на реке между Згожелецем и Гёрлицем.
  const X = Math.floor(worldX(14.995));
  const Y = Math.floor(worldY(51.1527));

  const tileX = (lng: number) => (worldX(lng) - X) * EXTENT;
  const tileY = (lat: number) => (worldY(lat) - Y) * EXTENT;

  /** Квадратный дом. reverse меняет обход контура: так задаются внутренние дворы. */
  const house = (lng: number, lat: number, half = 12, reverse = false) => {
    const cx = Math.round(tileX(lng));
    const cy = Math.round(tileY(lat));
    const ring: [number, number][] = [
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
      [cx - half, cy - half],
    ];
    return reverse ? ring.reverse() : ring;
  };

  const POLISH = [15.003, 51.1528] as const;
  const GERMAN = [14.9872, 51.1526] as const;

  const encode = (features: { tags: Record<string, unknown>; geometry: [number, number][][] }[]) => {
    const tile = { features: features.map((f) => ({ type: 3, ...f })), transformed: true, source: null, x: X, y: Y, z: Z };
    const other = { features: [{ type: 3, tags: {}, geometry: [house(...POLISH)] }], transformed: true, source: null, x: X, y: Y, z: Z };
    const bytes = fromGeojsonVt({ building: tile, water: other } as never, { version: 2, extent: EXTENT });
    return bytes.slice().buffer as ArrayBuffer;
  };

  const rings = () => {
    const area = classifyArea(tileBox(Z, X, Y));
    if (area.kind !== 'border') throw new Error('участок должен быть на границе');
    return area.rings;
  };

  const decode = (data: ArrayBuffer) => new VectorTile(new PbfReader(new Uint8Array(data)));

  it('точки теста стоят по разные стороны границы и попадают в участок', () => {
    expect(isInPoland({ lng: POLISH[0], lat: POLISH[1] })).toBe(true);
    expect(isInPoland({ lng: GERMAN[0], lat: GERMAN[1] })).toBe(false);
    for (const [lng, lat] of [POLISH, GERMAN]) {
      expect(tileX(lng)).toBeGreaterThan(0);
      expect(tileX(lng)).toBeLessThan(EXTENT);
      expect(tileY(lat)).toBeGreaterThan(0);
      expect(tileY(lat)).toBeLessThan(EXTENT);
    }
  });

  it('из склеенного объекта остаётся только польский дом', () => {
    const data = encode([{ tags: { render_height: 5 }, geometry: [house(...POLISH), house(...GERMAN)] }]);
    const layer = decode(keepPolishBuildings(data, Z, X, Y, rings())).layers.building;
    expect(layer.length).toBe(1);
    const geometry = layer.feature(0).loadGeometry();
    expect(geometry.length).toBe(1);
    expect(Math.abs(geometry[0][0].x - tileX(POLISH[0]))).toBeLessThan(20);
  });

  it('объект только с немецкими домами исчезает полностью', () => {
    const data = encode([{ tags: {}, geometry: [house(...GERMAN)] }]);
    expect(keepPolishBuildings(data, Z, X, Y, rings()).byteLength).toBe(0);
  });

  it('сохраняются высота и пометки дома', () => {
    const data = encode([
      { tags: { render_height: 15, render_min_height: 3, hide_3d: true }, geometry: [house(...POLISH)] },
    ]);
    const layer = decode(keepPolishBuildings(data, Z, X, Y, rings())).layers.building;
    expect(layer.feature(0).properties).toMatchObject({ render_height: 15, render_min_height: 3, hide_3d: true });
  });

  it('внутренний двор остаётся у своего дома', () => {
    const outer = house(...POLISH, 40);
    const courtyard = house(...POLISH, 10, true);
    const data = encode([{ tags: {}, geometry: [outer, courtyard, house(...GERMAN)] }]);
    const geometry = decode(keepPolishBuildings(data, Z, X, Y, rings())).layers.building.feature(0).loadGeometry();
    expect(geometry.length).toBe(2);
  });

  it('в результате нет других слоёв и лишних данных', () => {
    const data = encode([{ tags: {}, geometry: [house(...POLISH)] }]);
    expect(Object.keys(decode(data).layers).sort()).toEqual(['building', 'water']);
    expect(Object.keys(decode(keepPolishBuildings(data, Z, X, Y, rings())).layers)).toEqual(['building']);
  });

  it('участок без слоя зданий даёт пустой результат', () => {
    const other = { features: [], transformed: true, source: null, x: X, y: Y, z: Z };
    const bytes = fromGeojsonVt({ water: other } as never, { version: 2, extent: EXTENT });
    expect(keepPolishBuildings(bytes.slice().buffer as ArrayBuffer, Z, X, Y, rings()).byteLength).toBe(0);
  });
});

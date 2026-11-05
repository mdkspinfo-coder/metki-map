import { addProtocol, removeProtocol } from 'maplibre-gl';
import { classifyArea } from '../shared/poland';
import { keepPolishBuildings, tileBox } from '../shared/poland-tiles';

const PROTOCOL = 'poland-buildings';

export const POLAND_BUILDINGS_TILES = `${PROTOCOL}://{z}/{x}/{y}`;

const EMPTY_TILE = () => ({ data: new ArrayBuffer(0) });

/**
 * Источник участков карты только с польскими зданиями.
 * Вне страны участок вообще не загружается, внутри отдаётся как есть,
 * и лишь участки на границе разбираются по домам.
 */
export function registerPolandBuildings(sourceTiles: string) {
  removeProtocol(PROTOCOL);
  addProtocol(PROTOCOL, async ({ url }, abortController) => {
    const match = /(\d+)\/(\d+)\/(\d+)$/.exec(url);
    if (!match) throw new Error(`Неверный адрес участка: ${url}`);
    const [z, x, y] = match.slice(1).map(Number);

    const area = classifyArea(tileBox(z, x, y));
    if (area.kind === 'outside') return EMPTY_TILE();

    const address = sourceTiles
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    const response = await fetch(address, { signal: abortController.signal });
    // Там, где нет данных, сервер отвечает 204 или 404: это не ошибка, а пустой участок.
    if (response.status === 204 || response.status === 404) return EMPTY_TILE();
    if (!response.ok) throw new Error(`Участок карты: HTTP ${response.status}`);

    const data = await response.arrayBuffer();
    if (area.kind === 'inside') return { data };
    return { data: keepPolishBuildings(data, z, x, y, area.rings) };
  });
}

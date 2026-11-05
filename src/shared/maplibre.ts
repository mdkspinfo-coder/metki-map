import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Без этой строки карта работает в режиме разработки, но ломается после сборки:
// MapLibre ищет воркер рядом со своим файлом, а сборщик его туда не кладёт.
setWorkerUrl(workerUrl);

/** Бесплатные векторные карты на данных OpenStreetMap, ключ не нужен. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

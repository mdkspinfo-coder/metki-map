import {
  AttributionControl,
  Map as MapLibre,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapMouseEvent,
  type VectorTileSource,
} from 'maplibre-gl';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { isEmulator } from '../shared/firebase';
import { ACTIVATION_RADIUS_M, circleRing, type LatLng } from '../shared/geo';
import { MAP_STYLE_URL } from '../shared/maplibre';
import { POLAND_CENTER, isInPoland } from '../shared/poland';
import { POLAND_BUILDINGS_TILES, registerPolandBuildings } from './poland-buildings';

export interface MapPoint extends LatLng {
  id: string;
  state: 'active' | 'idle' | 'pending';
}

export interface PopupContent extends LatLng {
  id: string;
  title: string;
  caption: string;
  badge?: string;
}

export interface MapHandle {
  flyTo: (target: LatLng, minZoom?: number) => void;
  center: () => LatLng;
  zoom: () => number;
}

interface MapCanvasProps {
  ref: Ref<MapHandle>;
  points: MapPoint[];
  gps: (LatLng & { accuracy: number }) | null;
  showRange: boolean;
  placing: boolean;
  popup: PopupContent | null;
  onPointTap: (id: string) => void;
  onEmptyTap: () => void;
  onPopupClose: () => void;
  onFailure: (message: string) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const polygon = (ring: [number, number][]): GeoJSON.Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [ring] },
});

/** На этом зуме в данных карты появляются все здания. */
const BUILDINGS_ZOOM = 14;

/** 3D только в Польше. Плоские контуры остаются везде, иначе за границей здания пропали бы. */
function setupBuildings(map: MapLibre) {
  const beforeLabels = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
  if (map.getLayer('building-3d')) map.removeLayer('building-3d');
  if (map.getLayer('building')) map.setLayerZoomRange('building', 13, 24);

  const sourceTiles = map.getSource<VectorTileSource>('openmaptiles')?.tiles?.[0];
  if (!sourceTiles) {
    // Карта при этом работает, просто без объёмных зданий.
    console.error('В стиле карты не найден источник зданий');
    return;
  }
  registerPolandBuildings(sourceTiles);
  map.addSource('poland-buildings', {
    type: 'vector',
    tiles: [POLAND_BUILDINGS_TILES],
    minzoom: BUILDINGS_ZOOM,
    maxzoom: BUILDINGS_ZOOM,
  });
  map.addLayer(
    {
      id: 'poland-buildings-3d',
      type: 'fill-extrusion',
      source: 'poland-buildings',
      'source-layer': 'building',
      minzoom: BUILDINGS_ZOOM,
      // hide_3d: контур здания, у которого в данных есть отдельные части.
      filter: ['!', ['has', 'hide_3d']],
      paint: {
        'fill-extrusion-base': ['get', 'render_min_height'],
        'fill-extrusion-height': ['get', 'render_height'],
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['get', 'render_height'],
          0,
          '#e8e2d9',
          40,
          '#d5d3cf',
          150,
          '#b4c2d1',
        ],
        'fill-extrusion-opacity': 0.92,
      },
    },
    beforeLabels,
  );
}

function setupOverlays(map: MapLibre) {
  for (const id of ['gps-accuracy', 'gps-range', 'gps-point', 'points']) {
    map.addSource(id, { type: 'geojson', data: EMPTY });
  }
  map.addLayer({
    id: 'gps-accuracy-fill',
    type: 'fill',
    source: 'gps-accuracy',
    paint: { 'fill-color': '#1a66e0', 'fill-opacity': 0.14 },
  });
  map.addLayer({
    id: 'gps-range-line',
    type: 'line',
    source: 'gps-range',
    paint: {
      'line-color': '#15924a',
      'line-width': 1.5,
      'line-opacity': 0.6,
      'line-dasharray': [3, 3],
    },
  });
  map.addLayer({
    id: 'points-halo',
    type: 'circle',
    source: 'points',
    filter: ['==', ['get', 'state'], 'active'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 13, 16, 22],
      'circle-color': '#15924a',
      'circle-opacity': 0.24,
    },
  });
  map.addLayer({
    id: 'points-dot',
    type: 'circle',
    source: 'points',
    layout: {
      'circle-sort-key': ['match', ['get', 'state'], 'active', 2, 'pending', 1, 0],
    },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 16, 11],
      'circle-color': [
        'match',
        ['get', 'state'],
        'active',
        '#15924a',
        'pending',
        '#d98a00',
        '#5f6f80',
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5,
    },
  });
  map.addLayer({
    id: 'gps-dot',
    type: 'circle',
    source: 'gps-point',
    paint: {
      'circle-radius': 8,
      'circle-color': '#1a66e0',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
}

function buildPopup({ title, caption, badge }: PopupContent): HTMLElement {
  // textContent, а не HTML: тексты пишут пользователи.
  const root = document.createElement('div');
  root.className = 'marker-popup';
  if (badge) {
    const label = document.createElement('span');
    label.className = 'marker-popup-badge';
    label.textContent = badge;
    root.append(label);
  }
  const heading = document.createElement('strong');
  heading.className = 'marker-popup-title';
  heading.textContent = title;
  const body = document.createElement('p');
  body.className = 'marker-popup-caption';
  body.textContent = caption;
  root.append(heading, body);
  return root;
}

export function MapCanvas(props: MapCanvasProps) {
  const { ref, points, gps, showRange, popup } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const [ready, setReady] = useState(false);

  // Обработчики карты создаются один раз: свежие значения читаем через ref.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let map: MapLibre;
    try {
      map = new MapLibre({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: POLAND_CENTER,
        zoom: 5.3,
        maxPitch: 70,
        attributionControl: false,
      });
    } catch (error) {
      console.error(error);
      latest.current.onFailure('Браузер не поддерживает WebGL, поэтому карта не может открыться.');
      return undefined;
    }
    mapRef.current = map;
    if (isEmulator) (window as unknown as { __map: MapLibre }).__map = map;

    // Кнопки справа внизу заняты, поэтому подпись источников слева.
    map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

    let loaded = false;
    map.on('load', () => {
      loaded = true;
      setupBuildings(map);
      setupOverlays(map);
      setReady(true);
    });
    map.on('error', (event) => {
      console.error(event.error);
      if (!loaded) latest.current.onFailure('Не удалось загрузить карту. Проверьте интернет.');
    });

    const handleClick = (event: MapMouseEvent) => {
      if (latest.current.placing) {
        map.easeTo({ center: event.lngLat });
        return;
      }
      const { x, y } = event.point;
      // Запас вокруг точки: по маленькой метке трудно попасть пальцем.
      const hits = map.queryRenderedFeatures(
        [
          [x - 14, y - 14],
          [x + 14, y + 14],
        ],
        { layers: ['points-dot'] },
      );
      const id = hits[0]?.properties?.id;
      if (typeof id === 'string') latest.current.onPointTap(id);
      else latest.current.onEmptyTap();
    };
    map.on('click', handleClick);
    map.on('mouseenter', 'points-dot', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'points-dot', () => {
      map.getCanvas().style.cursor = '';
    });

    return () => {
      setReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (target, minZoom = 17) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [target.lng, target.lat],
          zoom: Math.max(map.getZoom(), minZoom),
          // Наклон показывает здания объёмно. За пределами Польши 3D нет, и он не нужен.
          pitch: isInPoland(target) ? 55 : 0,
          essential: true,
        });
      },
      center: () => {
        const map = mapRef.current;
        if (!map) return { lat: POLAND_CENTER[1], lng: POLAND_CENTER[0] };
        // wrap(): после прокрутки карты вокруг Земли долгота выходит за пределы ±180.
        const { lat, lng } = map.getCenter().wrap();
        return { lat, lng };
      },
      zoom: () => mapRef.current?.getZoom() ?? 0,
    }),
    [],
  );

  useEffect(() => {
    const source = ready ? mapRef.current?.getSource<GeoJSONSource>('points') : undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: points.map((point) => ({
        type: 'Feature',
        properties: { id: point.id, state: point.state },
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
      })),
    });
  }, [points, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const set = (id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) =>
      map.getSource<GeoJSONSource>(id)?.setData(data);
    if (!gps) {
      for (const id of ['gps-accuracy', 'gps-range', 'gps-point']) set(id, EMPTY);
      return;
    }
    set('gps-accuracy', polygon(circleRing(gps, gps.accuracy)));
    set('gps-range', showRange ? polygon(circleRing(gps, ACTIVATION_RADIUS_M)) : EMPTY);
    set('gps-point', {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [gps.lng, gps.lat] },
    });
  }, [gps, showRange, ready]);

  const popupId = popup?.id;
  const popupTitle = popup?.title;
  const popupCaption = popup?.caption;
  const popupBadge = popup?.badge;
  const popupLat = popup?.lat;
  const popupLng = popup?.lng;

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || popupId === undefined) return undefined;
    const content: PopupContent = {
      id: popupId,
      title: popupTitle ?? '',
      caption: popupCaption ?? '',
      badge: popupBadge,
      lat: popupLat ?? 0,
      lng: popupLng ?? 0,
    };
    // closeOnClick выключен: клик по другой метке обрабатывается в одном месте, иначе
    // закрытие старой и открытие новой спорили бы, кто сработает последним.
    const instance = new Popup({ closeOnClick: false, offset: 18, maxWidth: '300px' })
      .setLngLat([content.lng, content.lat])
      .setDOMContent(buildPopup(content))
      .addTo(map);
    const handleClose = () => latest.current.onPopupClose();
    instance.on('close', handleClose);
    return () => {
      instance.off('close', handleClose);
      instance.remove();
    };
  }, [ready, popupId, popupTitle, popupCaption, popupBadge, popupLat, popupLng]);

  return <div ref={containerRef} className="map" data-ready={ready} />;
}

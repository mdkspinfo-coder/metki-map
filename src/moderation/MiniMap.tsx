import { Map as MapLibre, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { LatLng } from '../shared/geo';
import { MAP_STYLE_URL } from '../shared/maplibre';
import { Modal } from '../shared/Modal';

export function MiniMapDialog({ title, point, onClose }: { title: string; point: LatLng; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const map = new MapLibre({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [point.lng, point.lat],
      zoom: 15,
    });
    new Marker({ color: '#cf3a2c' }).setLngLat([point.lng, point.lat]).addTo(map);
    return () => map.remove();
  }, [point.lat, point.lng]);

  return (
    <Modal title={title} onClose={onClose} wide>
      <div ref={containerRef} className="mini-map" />
      <p className="field-hint">
        {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
      </p>
    </Modal>
  );
}

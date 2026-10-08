/**
 * Ekran disi kurye gostergesinin haritayi izlemesi: kaydirma ve boyut
 * degisiminde (move, resize) yeniden hesaplar; yakinlastirma animasyonunda
 * (zoomanim) move gelmedigi icin hedef merkez ve seviyeyle ONCEDEN hesaplar
 * (gosterge animasyon boyunca eski yerde kalmaz). Sonuc gostergenin merkezi:
 * kenardan iceride ve Leaflet kontrollerinin yaninda (indicatorCenter).
 * Dinleyiciler donen fonksiyonla kaldirilir (her on'un off'u). React'siz:
 * testte sahte harita.
 */

import type { GeoPoint } from '@getir/contracts';
import type { Map as LeafletMap, ZoomAnimEvent } from 'leaflet';

import { edgePlacement, indicatorCenter } from './edge-placement';
import type { EdgePlacement, Rect } from './edge-placement';

const VIEW_EVENTS = 'move resize';

export interface EdgeGeometry {
  /** Kurye isaretinin yaricapi (px); isaret henuz yoksa 0. */
  readonly radius: () => number;
  /** Gostergenin kenardan payi (px; yarim boy + bosluk). */
  readonly inset: () => number;
  /** Ustune binilmeyecek Leaflet kontrolleri (kap icinde px). */
  readonly obstacles: () => readonly Rect[];
}

export function watchEdgePlacement(
  map: LeafletMap,
  courier: GeoPoint,
  geometry: EdgeGeometry,
  onChange: (placement: EdgePlacement | null) => void,
): () => void {
  const latLng: [number, number] = [courier.lat, courier.lng];
  const size = () => {
    const { x, y } = map.getSize();
    return { width: x, height: y };
  };
  const emit = (point: { x: number; y: number }) => {
    const box = size();
    const placement = edgePlacement(box, point, geometry.radius());
    onChange(
      placement === null
        ? null
        : indicatorCenter(placement, box, geometry.inset(), geometry.obstacles()),
    );
  };
  const update = () => emit(map.latLngToContainerPoint(latLng));
  const animate = (event: ZoomAnimEvent) => {
    const box = size();
    const target = map.project(latLng, event.zoom);
    const center = map.project(event.center, event.zoom);
    emit({ x: target.x - center.x + box.width / 2, y: target.y - center.y + box.height / 2 });
  };
  update();
  map.on(VIEW_EVENTS, update);
  map.on('zoomanim', animate);
  return () => {
    map.off(VIEW_EVENTS, update);
    map.off('zoomanim', animate);
  };
}

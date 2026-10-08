import type { GeoPoint } from '@getir/contracts';
import type { Map as LeafletMap } from 'leaflet';
import { useEffect, useRef, useState } from 'react';

import { samePlacement } from '../services/edge-placement';
import type { EdgePlacement } from '../services/edge-placement';
import { watchEdgePlacement } from '../services/edge-watch';
import type { EdgeGeometry } from '../services/edge-watch';

/**
 * Kurye gorunen alanin disindaysa kenardaki yeri, degilse null
 * (watchEdgePlacement). Harita ya da kurye degisince yeniden abone olur,
 * cikista dinleyiciler kalkar. Deger degismediyse yeniden cizim yok.
 */
export function useEdgePlacement(
  leaflet: LeafletMap | null,
  point: GeoPoint | undefined,
  geometry: EdgeGeometry,
): EdgePlacement | null {
  const [placement, setPlacement] = useState<EdgePlacement | null>(null);
  const measure = useRef(geometry);
  measure.current = geometry;
  const lat = point?.lat;
  const lng = point?.lng;
  useEffect(() => {
    if (leaflet === null || lat === undefined || lng === undefined) {
      setPlacement(null);
      return undefined;
    }
    return watchEdgePlacement(
      leaflet,
      { lat, lng },
      {
        radius: () => measure.current.radius(),
        inset: () => measure.current.inset(),
        obstacles: () => measure.current.obstacles(),
      },
      (next) => setPlacement((current) => (samePlacement(current, next) ? current : next)),
    );
  }, [leaflet, lat, lng]);
  return placement;
}

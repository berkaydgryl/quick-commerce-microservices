/**
 * Kurye haritasinin isaretleri (F22): Leaflet divIcon. Gorsel sabit SVG
 * (kullanici verisi icermez); renk ve boyut CSS'ten (token). Boyut ve capa
 * Leaflet'e verilmez: CSS genislik, yukseklik ve negatif kenar boslugu ile
 * ortalar (Leaflet konum icin transform kullanir, ona dokunulmaz).
 */

import L from 'leaflet';

import { markerHtml } from './tracking-marker-svg';
import type { MarkerKind } from './tracking-marker-svg';

/** Isaretin ikonu; className CSS modulunden (c-tracking-map__marker--kind). */
export function markerIcon(kind: MarkerKind, className: string): L.DivIcon {
  // iconSize yok: Leaflet satir ici boyut ve kenar boslugu yazmaz, CSS yazar.
  return L.divIcon({ className, html: markerHtml(kind), iconSize: undefined });
}

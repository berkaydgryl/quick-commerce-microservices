/**
 * Kurye haritasinin isaretleri (F22): Leaflet divIcon. Gorsel sabit SVG
 * (kullanici verisi icermez); renk ve boyut CSS'ten (token). Boyut ve capa
 * Leaflet'e verilmez: CSS genislik, yukseklik ve negatif kenar boslugu ile
 * ortalar (Leaflet konum icin transform kullanir, ona dokunulmaz).
 */

import L from 'leaflet';

/** Motorlu kurye (yan gorunus): iki teker, govde, gidon. */
const COURIER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h7l2-6h-3"/><path d="M14 6h2.5l1 5"/><path d="M4 13h6l1.5 4"/></svg>';

/** Magaza (sepet panelinin StoreIcon cizimi): tente ve vitrin. */
const MARKET_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 9h16l-1-4H5z"/><path d="M4 9v1a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0V9"/><path d="M5 12.5V20h14v-7.5"/><path d="M9.5 20v-4.5h5V20"/></svg>';

/** Ev pimi (adres haritasinin HomePinIcon cizimi): mor damla, beyaz ev. */
const HOME_SVG =
  '<svg viewBox="0 0 40 48" aria-hidden="true" focusable="false"><path d="M20 47s17-15.6 17-28A17 17 0 0 0 3 19c0 12.4 17 28 17 28z" fill="currentColor"/><path d="M12 20.5 20 13l8 7.5V28a1 1 0 0 1-1 1h-4.5v-5h-5v5H13a1 1 0 0 1-1-1z" fill="none" style="stroke:var(--text-on-brand)" stroke-width="2" stroke-linejoin="round"/></svg>';

export type MarkerKind = 'courier' | 'market' | 'home';

const SVG: Readonly<Record<MarkerKind, string>> = {
  courier: COURIER_SVG,
  market: MARKET_SVG,
  home: HOME_SVG,
};

/** Isaretin ikonu; className CSS modulunden (c-tracking-map__marker--kind). */
export function markerIcon(kind: MarkerKind, className: string): L.DivIcon {
  // iconSize yok: Leaflet satir ici boyut ve kenar boslugu yazmaz, CSS yazar.
  return L.divIcon({ className, html: SVG[kind], iconSize: undefined });
}

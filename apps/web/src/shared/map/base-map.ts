import type { MapContent } from '@getir/contracts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import styles from './BaseMap.module.css';
import { baseMapOptions } from './map-options';

export interface BaseMapOptions {
  readonly center: L.LatLngExpression;
  readonly zoom: number;
  /** false: kucuk onizleme; surukleme, yakinlastirma ve klavye kapali. */
  readonly interactive: boolean;
  /**
   * Yakinlastirma nereden: 'center' (adres haritasi: pin ortada sabit) ya da
   * 'pointer' (kurye haritasi: imlecin ya da parmaklarin oldugu yer).
   */
  readonly zoomAround?: 'center' | 'pointer';
}

export interface BaseMap {
  readonly leaflet: L.Map;
  /** Gozlemciyi ve haritayi kaldirir (bilesen sokulurken). */
  readonly dispose: () => void;
}

/**
 * Ortak harita kurulumu (T11.8'de adres haritasinda yazildi; F22'de kurye
 * haritasi icin ayrildi): OpenStreetMap karolari (adres ve atif icerik
 * ucundan), duz metin atif (OSM lisansi geregi gorunur; HTML sayilmaz) ve kap
 * boyu degisince karolarin yeniden hesaplanmasi; kesirli pikselde karo dikisi
 * olmaz (BaseMap.module.css). Iki harita da ayni karo ve atifla, ayni
 * ayarlarla acilir.
 */
export function createBaseMap(
  element: HTMLElement,
  map: Pick<MapContent, 'tileUrl' | 'attribution'>,
  { center, zoom, interactive, zoomAround = 'center' }: BaseMapOptions,
): BaseMap {
  const seamFix = styles['c-base-map'];
  if (seamFix !== undefined) {
    element.classList.add(seamFix);
  }
  const reducedMotion = prefersReducedMotion();
  const leaflet = L.map(element, {
    center,
    zoom,
    ...baseMapOptions({ interactive, zoomAround, reducedMotion }),
  });
  if (reducedMotion) {
    // Leaflet'in klavye kaydirmasi panBy'i secenek vermeden cagirir ve hep
    // animasyonludur; hareket azaltmada animasyonsuz (proje kurali; code-review).
    const panBy = leaflet.panBy.bind(leaflet);
    leaflet.panBy = (offset, options) => panBy(offset, { ...options, animate: false });
  }
  L.tileLayer(map.tileUrl, { maxZoom: 19 }).addTo(leaflet);
  L.control
    .attribution({ prefix: false })
    .addAttribution(escapeHtml(map.attribution))
    .addTo(leaflet);
  // Pencere ya da ekran boyu degisince karolar yeniden hesaplanir.
  const resize = new ResizeObserver(() => leaflet.invalidateSize());
  resize.observe(element);
  return {
    leaflet,
    dispose: () => {
      resize.disconnect();
      leaflet.remove();
    },
  };
}

/** Hareket azaltma acik mi (harita gecisleri animasyonsuz). */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Atif metni Leaflet'e HTML olarak gider: icerikteki metin isaretleme sayilmasin. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

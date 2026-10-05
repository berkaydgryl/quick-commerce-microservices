import type { GeoPoint, MapContent } from '@getir/contracts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

import { isSamePoint } from '../services/geo-point';

import styles from './AddressMap.module.css';
import { HomePinIcon } from './icons';

interface AddressMapProps {
  readonly map: MapContent;
  /** Haritanin ortasi = pinin gosterdigi nokta. */
  readonly center: GeoPoint;
  /** Haritanin erisilebilir adi (pin ipucu). */
  readonly label: string;
  /** false: kucuk onizleme (2. adim); surukleme ve yakinlastirma kapali. */
  readonly interactive: boolean;
  /** Pinin ustundeki ipucu ("Adresini secmek icin Pin'i surukle"); yalnizca 1. adimda. */
  readonly hint?: string | undefined;
  /** Kullanici haritayi surukleyip birakinca (ya da yakinlastirinca) yeni orta nokta. */
  readonly onMove?: ((center: GeoPoint) => void) | undefined;
}

/**
 * Adres haritasi (T11.8): OpenStreetMap karolari (Leaflet). Pin haritanin
 * ORTASINDA sabittir, harita onun altinda kayar (referans: getir.com); secilen
 * nokta haritanin ortasidir. Pin ve ipucu Leaflet'in degil sayfanin ogesidir:
 * marker gorseli gerekmez, renk token'dan gelir.
 *
 * Karo adresi ve atif icerik ucundan gelir. Atif OSM lisansi geregi haritada
 * gorunur; metin HTML olarak degil duz metin olarak eklenir.
 */
export function AddressMap({ map, center, label, interactive, hint, onMove }: AddressMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<L.Map | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const initialCenter = useRef(center);

  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return undefined;
    }
    const leaflet = L.map(element, {
      center: [initialCenter.current.lat, initialCenter.current.lng],
      zoom: map.zoom,
      zoomControl: interactive,
      dragging: interactive,
      touchZoom: interactive ? 'center' : false,
      scrollWheelZoom: interactive ? 'center' : false,
      doubleClickZoom: interactive ? 'center' : false,
      boxZoom: false,
      keyboard: interactive,
      attributionControl: false,
    });
    L.tileLayer(map.tileUrl, { maxZoom: 19 }).addTo(leaflet);
    L.control
      .attribution({ prefix: false })
      .addAttribution(escapeHtml(map.attribution))
      .addTo(leaflet);
    leaflet.on('moveend', () => {
      const { lat, lng } = leaflet.getCenter();
      onMoveRef.current?.({ lat, lng });
    });
    // Pencere ya da ekran boyu degisince karolar yeniden hesaplanir.
    const resize = new ResizeObserver(() => leaflet.invalidateSize());
    resize.observe(element);
    instance.current = leaflet;
    return () => {
      resize.disconnect();
      leaflet.remove();
      instance.current = null;
    };
  }, [map.tileUrl, map.attribution, map.zoom, interactive]);

  // Disaridan gelen yeni nokta (arama sonucu): harita oraya gider.
  const { lat, lng } = center;
  useEffect(() => {
    const leaflet = instance.current;
    if (leaflet === null) {
      return;
    }
    // Ayni nokta (~1 m): pin kendi hareketinden gelen merkezi yeniden uygulamaz.
    if (isSamePoint(leaflet.getCenter(), { lat, lng })) {
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    leaflet.setView([lat, lng], leaflet.getZoom(), { animate: !reduceMotion });
  }, [lat, lng]);

  return (
    <div
      className={`${styles['c-address-map']} ${interactive ? '' : styles['c-address-map--preview']}`}
    >
      <div
        ref={container}
        className={styles['c-address-map__canvas']}
        role="region"
        aria-label={label}
      />
      <div className={styles['c-address-map__pin']}>
        {hint !== undefined && <p className={styles['c-address-map__hint']}>{hint}</p>}
        <span className={styles['c-address-map__pin-icon']}>
          <HomePinIcon />
        </span>
      </div>
    </div>
  );
}

/** Atif metni Leaflet'e HTML olarak gider: icerikteki metin isaretleme sayilmasin. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

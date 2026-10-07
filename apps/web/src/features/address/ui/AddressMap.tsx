import type { GeoPoint, MapContent } from '@getir/contracts';
import type L from 'leaflet';
import { useEffect, useRef } from 'react';

import { createBaseMap, prefersReducedMotion } from '../../../shared/map/base-map';
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
 * Karo, atif ve boyut gozlemcisi ortak kurulumdan (shared/map/base-map.ts;
 * kurye haritasi da kullanir).
 */
export function AddressMap({ map, center, label, interactive, hint, onMove }: AddressMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<L.Map | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const initialCenter = useRef(center);
  const { tileUrl, attribution, zoom } = map;

  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return undefined;
    }
    const { leaflet, dispose } = createBaseMap(
      element,
      { tileUrl, attribution },
      { center: [initialCenter.current.lat, initialCenter.current.lng], zoom, interactive },
    );
    leaflet.on('moveend', () => {
      const { lat, lng } = leaflet.getCenter();
      onMoveRef.current?.({ lat, lng });
    });
    instance.current = leaflet;
    return () => {
      dispose();
      instance.current = null;
    };
  }, [tileUrl, attribution, zoom, interactive]);

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
    leaflet.setView([lat, lng], leaflet.getZoom(), { animate: !prefersReducedMotion() });
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

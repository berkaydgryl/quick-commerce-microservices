import type { GeoPoint, MapContent, OrderTracking } from '@getir/contracts';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

import { createBaseMap, prefersReducedMotion } from '../../../shared/map/base-map';

import styles from './TrackingMap.module.css';
import { markerIcon } from './tracking-markers';

interface TrackingMapProps {
  readonly map: Pick<MapContent, 'tileUrl' | 'attribution' | 'zoom'>;
  /** Haritanin erisilebilir adi. */
  readonly label: string;
  readonly tracking: OrderTracking;
}

/** Harita uc noktaya sigdirilirken kenardan birakilan bosluk (Leaflet piksel ister). */
const FIT_PADDING_PX = 32;

const latLng = (point: GeoPoint): L.LatLngTuple => [point.lat, point.lng];

/**
 * Kurye haritasi (F22): ortak kurulum (karo, atif; adres haritasiyla ayni).
 * Market -> adres rotasi mor yumusak cizgi; market ve ev isaretleri sabit.
 * Kurye isareti yalniz konum varken (paket alindiktan sonra; sozlesme
 * geregi TO_MARKET'ta konum yok) ve her yoklamada yerine kayar. Acilista uc
 * noktaya sigdirilir; sonra kullanicinin yakinlastirmasina dokunulmaz.
 * Hareket azaltmada gecisler animasyonsuz.
 */
export function TrackingMap({ map, label, tracking }: TrackingMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<L.Map | null>(null);
  const courier = useRef<L.Marker | null>(null);
  // Rota, market ve adres bir siparis icin degismez: ilk cevaptan kurulur.
  const initial = useRef(tracking);
  // Harita yeniden kurulursa (icerik degisti) kurye son konumuyla geri gelir.
  const latest = useRef(tracking.location);
  latest.current = tracking.location;
  const { tileUrl, attribution, zoom } = map;

  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return undefined;
    }
    const { route, marketLocation, deliveryLocation } = initial.current;
    const location = latest.current;
    const { leaflet, dispose } = createBaseMap(
      element,
      { tileUrl, attribution },
      { center: latLng(deliveryLocation), zoom, interactive: true, zoomAround: 'pointer' },
    );
    L.polyline(route.map(latLng), {
      className: styles['c-tracking-map__route'],
      interactive: false,
    }).addTo(leaflet);
    for (const [kind, point] of [
      ['market', marketLocation],
      ['home', deliveryLocation],
    ] as const) {
      L.marker(latLng(point), {
        icon: markerIcon(kind, markerClass(kind)),
        interactive: false,
        keyboard: false,
      }).addTo(leaflet);
    }
    const points = [
      marketLocation,
      deliveryLocation,
      ...(location === undefined ? [] : [location]),
    ];
    leaflet.fitBounds(L.latLngBounds(points.map(latLng)), {
      padding: [FIT_PADDING_PX, FIT_PADDING_PX],
      animate: false,
    });
    courier.current = location === undefined ? null : courierMarker(location).addTo(leaflet);
    instance.current = leaflet;
    return () => {
      dispose();
      instance.current = null;
      courier.current = null;
    };
  }, [tileUrl, attribution, zoom]);

  // Kurye: her yoklamada yeni konum; konum yoksa isaret yok.
  const lat = tracking.location?.lat;
  const lng = tracking.location?.lng;
  useEffect(() => {
    const leaflet = instance.current;
    if (leaflet === null) {
      return;
    }
    if (lat === undefined || lng === undefined) {
      courier.current?.remove();
      courier.current = null;
      return;
    }
    if (courier.current === null) {
      courier.current = courierMarker({ lat, lng }).addTo(leaflet);
      return;
    }
    courier.current.setLatLng([lat, lng]);
    // Kurye gorunen alanin disina cikarsa harita onu izler.
    if (!leaflet.getBounds().contains([lat, lng])) {
      leaflet.panTo([lat, lng], { animate: !prefersReducedMotion() });
    }
  }, [lat, lng]);

  return (
    <div className={styles['c-tracking-map']}>
      <div
        ref={container}
        className={styles['c-tracking-map__canvas']}
        role="region"
        aria-label={label}
      />
    </div>
  );
}

/** Kurye isareti: digerlerinin ustunde (zIndexOffset), tiklanmaz. */
function courierMarker(point: GeoPoint): L.Marker {
  return L.marker(latLng(point), {
    icon: markerIcon('courier', markerClass('courier')),
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
  });
}

function markerClass(kind: 'courier' | 'market' | 'home'): string {
  return `${styles['c-tracking-map__marker'] ?? ''} ${styles[`c-tracking-map__marker--${kind}`] ?? ''}`;
}

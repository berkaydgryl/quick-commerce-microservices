import type { CourierTrackingContent, GeoPoint, MapContent, OrderTracking } from '@getir/contracts';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';

import { createBaseMap, prefersReducedMotion } from '../../../shared/map/base-map';
import type { EdgeGeometry } from '../services/edge-watch';
import { distanceText } from '../services/tracking-format';

import { controlRects, tokenPx } from './map-geometry';

import { OffscreenCourierLayer } from './OffscreenCourier';
import styles from './TrackingMap.module.css';
import { markerIcon } from './tracking-markers';

interface TrackingMapProps {
  readonly map: Pick<MapContent, 'tileUrl' | 'attribution' | 'zoom'>;
  /** Haritanin erisilebilir adi. */
  readonly label: string;
  readonly tracking: OrderTracking;
  /** Ekran disi kurye gostergesinin metinleri (icerikten). */
  readonly texts: Pick<
    CourierTrackingContent,
    'offscreenCourierLabel' | 'distanceLabel' | 'meterSuffix' | 'kilometerSuffix'
  >;
}

/** Harita uc noktaya sigdirilirken kenardan birakilan bosluk (Leaflet piksel ister). */
const FIT_PADDING_PX = 32;

const latLng = (point: GeoPoint): L.LatLngTuple => [point.lat, point.lng];

/**
 * Kurye haritasi (F22): ortak kurulum (karo, atif; adres haritasiyla ayni).
 * Market ve ev isaretleri sabit; rota cizgisi YOK (duz cizgi binalarin
 * ustunden gecerdi; kullanici istegi). Kurye isareti yalniz konum varken
 * (paket alindiktan sonra; sozlesme geregi TO_MARKET'ta konum yok) ve her
 * yoklamada yerine kayar. Acilista uc noktaya sigdirilir; sonra harita
 * kendiliginden kaymaz (kullanicinin kaydirmasina ve yakinlastirmasina
 * dokunulmaz): kurye gorunen alanin disindaysa kenarda gosterge (yon ve
 * adrese kalan mesafe), basinca harita kuryeye kayar ve odak haritaya gecer.
 * Hareket azaltmada gecisler animasyonsuz.
 */
export function TrackingMap({ map, label, tracking, texts }: TrackingMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [leaflet, setLeaflet] = useState<L.Map | null>(null);
  const courier = useRef<L.Marker | null>(null);
  // Market ve adres bir siparis icin degismez: ilk cevaptan kurulur.
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
    const { marketLocation, deliveryLocation } = initial.current;
    const location = latest.current;
    const { leaflet: created, dispose } = createBaseMap(
      element,
      { tileUrl, attribution },
      { center: latLng(deliveryLocation), zoom, interactive: true, zoomAround: 'pointer' },
    );
    for (const [kind, point] of [
      ['market', marketLocation],
      ['home', deliveryLocation],
    ] as const) {
      L.marker(latLng(point), {
        icon: markerIcon(kind, markerClass(kind)),
        interactive: false,
        keyboard: false,
      }).addTo(created);
    }
    const points = [
      marketLocation,
      deliveryLocation,
      ...(location === undefined ? [] : [location]),
    ];
    created.fitBounds(L.latLngBounds(points.map(latLng)), {
      padding: [FIT_PADDING_PX, FIT_PADDING_PX],
      animate: false,
    });
    courier.current = location === undefined ? null : courierMarker(location).addTo(created);
    setLeaflet(created);
    return () => {
      dispose();
      setLeaflet(null);
      courier.current = null;
    };
  }, [tileUrl, attribution, zoom]);

  // Kurye: her yoklamada yeni konum; konum yoksa isaret yok.
  const lat = tracking.location?.lat;
  const lng = tracking.location?.lng;
  useEffect(() => {
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
  }, [leaflet, lat, lng]);

  // Gosterge kaybolur: odak bosa dusmesin, haritaya (klavyeyle kaydirilir) gecer.
  const focusMap = () => container.current?.focus({ preventScroll: true });
  const showCourier = () => {
    if (leaflet === null || lat === undefined || lng === undefined) {
      return;
    }
    leaflet.panTo([lat, lng], { animate: !prefersReducedMotion() });
    focusMap();
  };
  // Gostergenin olculeri: kenar payi bir kez olculur (token), kontroller her hesapta.
  const insetPx = useRef<number | null>(null);
  const geometry: EdgeGeometry = {
    radius: () => (courier.current?.getElement()?.offsetWidth ?? 0) / 2,
    inset: () => {
      const element = container.current;
      if (element === null) return 0;
      insetPx.current ??= tokenPx(element, '--size-tracking-edge-inset');
      return insetPx.current;
    },
    obstacles: () => (container.current === null ? [] : controlRects(container.current)),
  };
  // Teslimde mesafe yok (pencere de yazmaz).
  const distance =
    tracking.phase === 'DELIVERED' ? undefined : distanceText(tracking.remainingMeters, texts);

  return (
    <div className={styles['c-tracking-map']}>
      <div
        ref={container}
        className={styles['c-tracking-map__canvas']}
        role="region"
        aria-label={label}
      />
      <OffscreenCourierLayer
        leaflet={leaflet}
        location={tracking.location}
        geometry={geometry}
        distance={distance}
        texts={texts}
        onShow={showCourier}
        onLeave={focusMap}
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

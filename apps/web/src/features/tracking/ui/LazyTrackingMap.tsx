import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

import styles from './LazyTrackingMap.module.css';

/**
 * Harita (Leaflet) ayri pakette yuklenir (adres haritasi gibi): yalniz
 * "Kuryem nerede"yi acan indirir.
 */
const TrackingMap = lazy(() =>
  import('./TrackingMap').then((module) => ({ default: module.TrackingMap })),
);

/** Paket gelene kadar haritanin yerinde ayni boyda bos kutu: pencere ziplamaz. */
export function LazyTrackingMap(props: ComponentProps<typeof TrackingMap>) {
  return (
    <Suspense fallback={<div className={styles['c-tracking-map-placeholder']} aria-busy="true" />}>
      <TrackingMap {...props} />
    </Suspense>
  );
}

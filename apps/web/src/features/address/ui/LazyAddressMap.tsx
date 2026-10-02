import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

import styles from './LazyAddressMap.module.css';

/**
 * Harita (Leaflet) ayri pakette yuklenir (T11.8): yalnizca adres ekleyen
 * kullanici indirir; karsilama ve ana sayfa paketi buyumez.
 */
const AddressMap = lazy(() =>
  import('./AddressMap').then((module) => ({ default: module.AddressMap })),
);

type AddressMapProps = ComponentProps<typeof AddressMap>;

/** Paket gelene kadar haritanin yerinde ayni boyda bos kutu: pencere zipla(n)maz. */
export function LazyAddressMap(props: AddressMapProps) {
  const placeholder = (
    <div
      className={`${styles['c-address-map-placeholder']} ${
        props.interactive ? '' : styles['c-address-map-placeholder--preview']
      }`}
      aria-busy="true"
    />
  );
  return (
    <Suspense fallback={placeholder}>
      <AddressMap {...props} />
    </Suspense>
  );
}

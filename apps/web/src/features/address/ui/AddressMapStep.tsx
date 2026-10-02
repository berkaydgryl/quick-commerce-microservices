import type { AddressSetupContent, GeoPlace, GeoPoint } from '@getir/contracts';

import { AddressButton } from './AddressButton';
import styles from './AddressMapStep.module.css';
import { AddressSearch } from './AddressSearch';
import { LazyAddressMap } from './LazyAddressMap';

interface AddressMapStepProps {
  readonly content: AddressSetupContent;
  /** Pinin gosterdigi nokta (haritanin ortasi). */
  readonly center: GeoPoint;
  /** Kullanici bir nokta secti mi (haritayi oynatti ya da aramadan secti). */
  readonly chosen: boolean;
  /** Noktanin adresi soruluyor: dugme bekler. */
  readonly resolving: boolean;
  readonly onMove: (center: GeoPoint) => void;
  readonly onPick: (place: GeoPlace) => void;
  readonly onUse: () => void;
}

/**
 * Adres ekleme 1. adim (T11.8; referans: getir.com): arama kutusu, ortasinda
 * pin olan harita ve "Bu adresi kullan". Dugme kullanici bir nokta secene
 * kadar pasiftir: varsayilan nokta (demo semti) kimsenin adresi degildir.
 * "Konumumu kullan" bilincli olarak YOK (kullanicinin karari).
 */
export function AddressMapStep({
  content,
  center,
  chosen,
  resolving,
  onMove,
  onPick,
  onUse,
}: AddressMapStepProps) {
  return (
    <div className={styles['c-address-map-step']}>
      <AddressSearch content={content} onPick={onPick} />
      <LazyAddressMap
        map={content.map}
        center={center}
        label={content.pinHint}
        hint={content.pinHint}
        interactive
        onMove={onMove}
      />
      <AddressButton disabled={!chosen || resolving} aria-busy={resolving} onClick={onUse}>
        {resolving ? content.resolvingLabel : content.useAddressLabel}
      </AddressButton>
    </div>
  );
}

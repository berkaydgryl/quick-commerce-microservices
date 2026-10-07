import type { SavedAddress } from '@getir/contracts';
import { useId } from 'react';

import { addressFullText } from '../services/address-text';
import type { AddressPartLabels } from '../services/address-text';

import styles from './DeliveryAddressCard.module.css';

export interface DeliveryAddressCardTexts {
  readonly title: string;
  readonly noAddressNotice: string;
}

interface DeliveryAddressCardProps {
  /** Secili hesap adresi; varsayilan adreste (defterde kayit yok) undefined. */
  readonly address: SavedAddress | undefined;
  /** Gorunen ad ("Ev"): ust bardaki dugmeyle ayni. */
  readonly label: string;
  readonly texts: DeliveryAddressCardTexts;
  readonly partLabels: AddressPartLabels;
}

/**
 * Teslimat adresi karti (T16.3; referans getircarsi sepet sayfasi): "Adres"
 * basligi, beyaz kartta adin altinda tam metin. Kayitli adres yoksa adin
 * altinda ust bardaki dugmeye yonlendiren not. Degistirme ust bardadir.
 * Durumsuz.
 */
export function DeliveryAddressCard({
  address,
  label,
  texts,
  partLabels,
}: DeliveryAddressCardProps) {
  const titleId = useId();
  return (
    <section className={styles['c-delivery-address']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['c-delivery-address__title']}>
        {texts.title}
      </h2>
      <div className={styles['c-delivery-address__card']}>
        <p className={styles['c-delivery-address__name']}>{label}</p>
        <p className={styles['c-delivery-address__text']}>
          {address === undefined ? texts.noAddressNotice : addressFullText(address, partLabels)}
        </p>
      </div>
    </section>
  );
}

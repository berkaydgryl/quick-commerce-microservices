import type { DeliveryTime } from '@getir/contracts';

import { formatDeliveryTime } from '../../../shared/services/format';

import styles from './DeliveryTimeChip.module.css';

interface DeliveryTimeChipProps {
  readonly deliveryTime: DeliveryTime;
  /** Gorunen kisaltma ("TVS") ve ekran okuyucunun okudugu tam adi. */
  readonly texts: { readonly shortLabel: string; readonly label: string };
}

/**
 * Sade ust bardaki teslim suresi cipi (T16.3; referans getircarsi "TVS
 * 50-60 dk"): sari kutu; sure sepetin marketinin. Kisaltma ekran okuyucuya
 * kapali, yerine tam adi okunur.
 */
export function DeliveryTimeChip({ deliveryTime, texts }: DeliveryTimeChipProps) {
  return (
    <p className={styles['c-delivery-time']}>
      <span className={styles['c-delivery-time__sr']}>{texts.label}: </span>
      <span className={styles['c-delivery-time__short']} aria-hidden="true">
        {texts.shortLabel}
      </span>{' '}
      {formatDeliveryTime(deliveryTime)}
    </p>
  );
}

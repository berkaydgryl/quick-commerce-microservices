import { useState } from 'react';

import { marketInitials } from '../services/market-initials';

import styles from './MarketBadge.module.css';

/** Kutunun olcusu: liste ve arama karti ya da magaza sayfasinin genis kapagi. */
export type MarketBadgeSize = 'card' | 'hero';

interface MarketBadgeProps {
  readonly brand: string;
  /** Markanin logosu (gateway mutlak adres verir); yoksa bas harf rozeti. */
  readonly logoUrl?: string | undefined;
  readonly size: MarketBadgeSize;
}

/**
 * Kapagin uzerindeki marka kutusu (T11.11; kullanici karari 07.10: gecici
 * olarak marka renginde yazi logo). Kapagin sol ORTASINDA, soldan kapak
 * genisliginin yuzdesi kadar iceride (--inset-market-badge); liste karti ve
 * magaza kapagi ayni kurali kullanir.
 *
 * logoUrl varsa beyaz kutuda logo (2:1, kutuya sigdirilir); yoksa ya da logo
 * yuklenemezse bas harf rozeti. Logo DEKORATIF (alt=""): market adi hemen
 * yaninda metin olarak var; ad olsaydi ekran okuyucu iki kez okurdu.
 */
export function MarketBadge({ brand, logoUrl, size }: MarketBadgeProps) {
  const [failed, setFailed] = useState(false);
  const sized = `${styles['c-market-badge']} ${styles[`c-market-badge--${size}`]}`;

  if (logoUrl !== undefined && !failed) {
    return (
      <span className={`${sized} ${styles['c-market-badge--logo']}`}>
        <img
          className={styles['c-market-badge__logo']}
          src={logoUrl}
          alt=""
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className={sized} aria-hidden="true">
      {marketInitials(brand)}
    </span>
  );
}

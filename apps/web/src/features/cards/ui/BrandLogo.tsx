import type { CardBrand } from '@getir/contracts';

import styles from './BrandLogo.module.css';

const WORDMARK_CLASS: Readonly<Record<Exclude<CardBrand, 'MASTERCARD'>, string | undefined>> = {
  VISA: styles['c-brand-logo--visa'],
  AMEX: styles['c-brand-logo--amex'],
  TROY: styles['c-brand-logo--troy'],
};

interface BrandLogoProps {
  readonly brand: CardBrand;
  /** Yazili logolarin metni (icerikten kisa isaret: "VISA", "AMEX", "troy"). */
  readonly mark: string;
}

/**
 * Kart markasinin kucuk logosu (T11.17; D3: kendi cizimimiz, markalarin
 * renkleriyle): Mastercard ust uste iki daire, digerleri yazi. Suslemedir
 * (aria-hidden): markanin adi yaninda metin olarak var.
 */
export function BrandLogo({ brand, mark }: BrandLogoProps) {
  if (brand === 'MASTERCARD') {
    return (
      <svg
        className={styles['c-brand-logo']}
        viewBox="0 0 38 24"
        aria-hidden="true"
        focusable="false"
      >
        <circle className={styles['c-brand-logo__red']} cx="13" cy="12" r="10" />
        <circle className={styles['c-brand-logo__yellow']} cx="25" cy="12" r="10" />
        <path
          className={styles['c-brand-logo__overlap']}
          d="M19 4a10 10 0 0 1 0 16a10 10 0 0 1 0-16z"
        />
      </svg>
    );
  }
  return (
    <span className={`${styles['c-brand-logo']} ${WORDMARK_CLASS[brand]}`} aria-hidden="true">
      {mark}
    </span>
  );
}

import type { CardBrand, CardBrandLabels } from '@getir/contracts';

import styles from './BrandPills.module.css';

const BRANDS: readonly CardBrand[] = ['VISA', 'MASTERCARD', 'AMEX', 'TROY'];

interface BrandPillsProps {
  readonly labels: CardBrandLabels;
  /** Listenin erisilebilir adi: "Desteklenen kartlar". */
  readonly label: string;
  /** Yazilan numaranin markasi: o hap vurgulu. */
  readonly active: CardBrand | null;
}

/** Desteklenen kartlar (tasarim B basligi): yazilan numaranin markasi vurgulanir. */
export function BrandPills({ labels, label, active }: BrandPillsProps) {
  return (
    <ul className={styles['c-brand-pills']} role="list" aria-label={label}>
      {BRANDS.map((brand) => (
        <li
          key={brand}
          className={
            brand === active
              ? `${styles['c-brand-pills__pill']} ${styles['is-active']}`
              : styles['c-brand-pills__pill']
          }
        >
          {labels[brand]}
        </li>
      ))}
    </ul>
  );
}

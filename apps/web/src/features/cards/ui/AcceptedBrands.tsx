import type { CardBrand, CardBrandLabels } from '@getir/contracts';

import styles from './AcceptedBrands.module.css';
import { BrandLogo } from './BrandLogo';

/** Referanstaki sira (getircarsi): Amex, Mastercard, Visa, Troy. */
const BRANDS: readonly CardBrand[] = ['AMEX', 'MASTERCARD', 'VISA', 'TROY'];

interface AcceptedBrandsProps {
  /** Listenin erisilebilir adi: "Kabul edilen kartlar". */
  readonly label: string;
  readonly labels: CardBrandLabels;
  readonly marks: CardBrandLabels;
  /** Yazilan numaranin markasi: o logo one cikar. */
  readonly active: CardBrand | null;
}

/**
 * Kabul edilen kartlar (T11.17; referans: formun altinda sagda logolar).
 * Logolar suslemedir; her maddenin adi gorunmez metinle okunur. Yazilan
 * numaranin markasi one cikar, digerleri soluklasir.
 */
export function AcceptedBrands({ label, labels, marks, active }: AcceptedBrandsProps) {
  return (
    <ul className={styles['c-accepted-brands']} role="list" aria-label={label}>
      {BRANDS.map((brand) => (
        <li
          key={brand}
          className={
            active !== null && brand !== active
              ? `${styles['c-accepted-brands__item']} ${styles['is-dimmed']}`
              : styles['c-accepted-brands__item']
          }
        >
          <BrandLogo brand={brand} mark={marks[brand]} />
          <span className={styles['c-accepted-brands__name']}>{labels[brand]}</span>
        </li>
      ))}
    </ul>
  );
}

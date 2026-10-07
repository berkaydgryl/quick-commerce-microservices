import { lowStockCount } from '../../services/low-stock';

import styles from './LowStockBadge.module.css';

interface LowStockBadgeProps {
  /** Bilinen stok (urun karti) ya da kalemin stok siniri (sepet satiri). */
  readonly stock: number | undefined;
  /** "Son" ve "adet": sayinin iki yani (marketPage). */
  readonly texts: { readonly lowStockPrefix: string; readonly lowStockSuffix: string };
}

/**
 * "Son 3 adet" rozeti (T16.3): urun kartinda ve sepet satirinda. Stok esigin
 * ustundeyse, bilinmiyorsa ya da 0'sa (0 "Tükendi"dir) cizilmez.
 */
export function LowStockBadge({ stock, texts }: LowStockBadgeProps) {
  const count = lowStockCount(stock);
  if (count === undefined) {
    return null;
  }
  return (
    <span className={styles['c-low-stock']}>
      {texts.lowStockPrefix} {count} {texts.lowStockSuffix}
    </span>
  );
}

import type { Product } from '@getir/contracts';

import { formatMoney } from '../../../shared/services/format';

import styles from './MarketCatalog.module.css';

/**
 * Urun listesi - TASARIMSIZ KABUK (T5.4): ad ve BU MARKETIN fiyati (ADR-15).
 * Stok rozeti yok: availableQuantity bugun gelmiyor ("stok bilgisi yok");
 * sepet dugmeleri T6.4 ile, kart tasarimi T16.2 ile gelir.
 */
export function MarketProductList({ products }: { readonly products: readonly Product[] }) {
  return (
    <ul className={styles['c-market-catalog__products']} role="list">
      {products.map((product) => (
        <li key={product.offerId} className={styles['c-market-catalog__product']}>
          <span>{product.name}</span>
          <span className={styles['c-market-catalog__price']}>{formatMoney(product.price)}</span>
        </li>
      ))}
    </ul>
  );
}

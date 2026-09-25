import type { Product } from '@getir/contracts';
import type { ReactNode } from 'react';

import { formatMoney } from '../../../shared/services/format';

import styles from './MarketCatalog.module.css';

/**
 * Urun listesi - TASARIMSIZ KABUK (T5.4): ad ve BU MARKETIN fiyati (ADR-15).
 * Stok rozeti yok: availableQuantity bugun gelmiyor ("stok bilgisi yok");
 * sepet dugmeleri T6.4 ile, kart tasarimi T16.2 ile gelir.
 */
interface MarketProductListProps {
  readonly products: readonly Product[];
  /**
   * Urunun yanina cizilecek eylem (bugun sepet dugmesi). Katalog sepeti
   * TANIMAZ: eylemi sayfa verir; kaldirmak ya da degistirmek katalogu etkilemez.
   */
  readonly renderAction?: (product: Product) => ReactNode;
}

export function MarketProductList({ products, renderAction }: MarketProductListProps) {
  return (
    <ul className={styles['c-market-catalog__products']} role="list">
      {products.map((product) => (
        <li key={product.offerId} className={styles['c-market-catalog__product']}>
          <span>{product.name}</span>
          <span className={styles['c-market-catalog__price']}>{formatMoney(product.price)}</span>
          {renderAction?.(product)}
        </li>
      ))}
    </ul>
  );
}

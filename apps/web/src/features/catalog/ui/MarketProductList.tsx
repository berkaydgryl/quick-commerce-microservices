import type { Product } from '@getir/contracts';
import type { ReactNode } from 'react';

import { formatMoney } from '../../../shared/services/format';

import styles from './MarketProductList.module.css';

/**
 * Urun satirlari (T5.4 kabugundan; T16.2'den beri yalnizca ana sayfa aramasi,
 * T9.6): ad ve BU MARKETIN fiyati (ADR-15). Magaza sayfasi kart izgarasini
 * kullanir (MarketProductGrid). Stok rozeti yok: "Son N adet" rozeti T16.3'te.
 * Satista olmayan ve stogu biten teklif de listelenir; "Satista degil" (T7.6)
 * ve "Tukendi" (T8.4) durumlarini sepet eylemi cizer.
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
    <ul className={styles['c-product-list']} role="list">
      {products.map((product) => (
        <li key={product.offerId} className={styles['c-product-list__item']}>
          <span>{product.name}</span>
          <span className={styles['c-product-list__price']}>{formatMoney(product.price)}</span>
          {renderAction?.(product)}
        </li>
      ))}
    </ul>
  );
}

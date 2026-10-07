import type { Category, Product } from '@getir/contracts';
import type { ReactNode } from 'react';

import { formatMoney } from '../../../shared/services/format';
import { LowStockBadge } from '../../../shared/ui/low-stock-badge/LowStockBadge';

import { CategoryIcon } from './CategoryIcon';
import styles from './ProductCard.module.css';

interface ProductCardProps {
  readonly product: Product;
  /** Urunun kategorisi: gorsel onun (K2); kategori listede yoksa bas harf. */
  readonly category: Category | undefined;
  /** Sag ustteki eylem (sepet dugmesi); sayfa verir, katalog sepeti tanimaz. */
  readonly action?: ReactNode;
  /** "Son 3 adet" rozetinin metinleri (T16.3). */
  readonly texts: { readonly lowStockPrefix: string; readonly lowStockSuffix: string };
  /** Market kapali (07.10): gorsel ve "+" gri; ad ve fiyat okunakli kalir. */
  readonly closed?: boolean | undefined;
}

/**
 * Urun karti (T16.2; referans getircarsi): ustte gorsel ve sag ust kosede
 * sepet dugmesi, altta mor fiyat (BU MARKETIN fiyati, ADR-15), ad ve gri
 * aciklama. Gramaj adin icindedir ("Beyaz Peynir 500 g"). Urun gorselleri
 * yayinda olmadigindan (B3) gorsel urunun kategorisinindir; product.imageUrl
 * ISTENMEZ, yoksa her urun 404 verirdi (K2). Stok azsa sol ustte "Son N adet"
 * (T16.3).
 */
export function ProductCard({ product, category, action, texts, closed }: ProductCardProps) {
  return (
    <li className={`${styles['c-product-card']} ${closed === true ? styles['is-closed'] : ''}`}>
      <div className={styles['c-product-card__media']}>
        <CategoryIcon
          name={category?.name ?? product.name}
          imageUrl={category?.imageUrl}
          variant="product"
        />
        {action !== undefined && <div className={styles['c-product-card__action']}>{action}</div>}
        <span className={styles['c-product-card__badge']}>
          {/* Satista olmayan teklifte "Son N adet" yok (dar kartta "Satışta değil"le cakisirdi). */}
          {product.isActive && <LowStockBadge stock={product.availableQuantity} texts={texts} />}
        </span>
      </div>
      <p className={styles['c-product-card__price']}>{formatMoney(product.price)}</p>
      <h3 className={styles['c-product-card__name']}>{product.name}</h3>
      {product.description !== undefined && (
        <p className={styles['c-product-card__description']}>{product.description}</p>
      )}
    </li>
  );
}

import type { Category, Product } from '@getir/contracts';
import type { ReactNode } from 'react';

import styles from './MarketCatalog.module.css';
import { ProductCard } from './ProductCard';

interface MarketProductGridProps {
  readonly products: readonly Product[];
  /** Marketin kategorileri: kartin gorseli urunun kategorisinin (K2). */
  readonly categories: readonly Category[] | undefined;
  /** Kartin sag ustundeki eylem (sepet dugmesi); sayfa verir. */
  readonly renderAction?: (product: Product) => ReactNode;
}

/**
 * Magaza sayfasinin urun izgarasi (T16.2): kartlar ince cizgilerle ayrilir
 * (referans getircarsi). Satista olmayan ve stogu biten teklif de listelenir;
 * "Satışta değil" (T7.6) ve "Tükendi" (T8.4) durumlarini sepet eylemi cizer.
 */
export function MarketProductGrid({ products, categories, renderAction }: MarketProductGridProps) {
  const categoryOf = (id: string) => categories?.find((category) => category.id === id);

  return (
    <ul className={styles['c-market-catalog__grid']} role="list">
      {products.map((product) => (
        <ProductCard
          key={product.offerId}
          product={product}
          category={categoryOf(product.categoryId)}
          action={renderAction?.(product)}
        />
      ))}
    </ul>
  );
}

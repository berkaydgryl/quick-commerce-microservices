import type { Product } from '@getir/contracts';
import type { ReactNode } from 'react';

import { QueryEmpty, QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useMarketCategories } from '../hooks/useMarketCategories';
import { useMarketProducts } from '../hooks/useMarketProducts';

import styles from './MarketCatalog.module.css';
import { MarketCategoryFilter } from './MarketCategoryFilter';
import { MarketProductList } from './MarketProductList';

interface MarketCatalogSectionProps {
  readonly marketId: string;
  readonly categoryId: string | undefined;
  readonly onCategoryChange: (categoryId: string | undefined) => void;
  /** Urun satirindaki eylem; sayfa verir (bkz. MarketProductList). */
  readonly renderProductAction?: (product: Product) => ReactNode;
}

/**
 * Marketin katalogu: kategori filtresi + urunler (imlecle "daha fazla").
 * Secili kategori sayfanin adres durumudur (URL); bu bolum onu yalnizca okur
 * ve degisikligi yukari bildirir.
 */
export function MarketCatalogSection({
  marketId,
  categoryId,
  onCategoryChange,
  renderProductAction,
}: MarketCatalogSectionProps) {
  const categories = useMarketCategories(marketId);
  const products = useMarketProducts(marketId, categoryId);
  const items = products.data;

  return (
    <section
      className={styles['c-market-catalog']}
      aria-labelledby="urunler-baslik"
      aria-busy={products.isPending}
    >
      <h2 id="urunler-baslik" className={styles['c-market-catalog__title']}>
        Ürünler
      </h2>

      {categories.data !== undefined && (
        <MarketCategoryFilter
          categories={categories.data}
          selectedId={categoryId}
          onSelect={onCategoryChange}
        />
      )}
      {categories.error !== null && (
        <QueryError error={categories.error} onRetry={() => void categories.refetch()} />
      )}

      {products.isPending && <QueryLoading>Ürünler yükleniyor…</QueryLoading>}
      {products.error !== null && (
        <QueryError error={products.error} onRetry={() => void products.refetch()} />
      )}
      {items !== undefined && items.length === 0 && (
        <QueryEmpty>Bu kategoride ürün yok.</QueryEmpty>
      )}
      {items !== undefined && items.length > 0 && (
        <MarketProductList
          products={items}
          {...(renderProductAction === undefined ? {} : { renderAction: renderProductAction })}
        />
      )}

      {products.hasNextPage && (
        <button
          type="button"
          className={styles['c-market-catalog__more']}
          disabled={products.isFetchingNextPage}
          onClick={() => void products.fetchNextPage()}
        >
          {products.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla ürün'}
        </button>
      )}
    </section>
  );
}

import type { MarketPageContent, Product } from '@getir/contracts';
import type { ReactNode } from 'react';
import { useId } from 'react';

import { QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useMarketCategories } from '../hooks/useMarketCategories';
import { useMarketProducts } from '../hooks/useMarketProducts';

import styles from './MarketCatalog.module.css';
import { MarketCategoryNav } from './MarketCategoryNav';
import { MarketProductGrid } from './MarketProductGrid';

interface MarketCatalogSectionProps {
  readonly marketId: string;
  readonly categoryId: string | undefined;
  /** Market ici arama (T9.5); varken kategori secili degildir (sayfa kurali). */
  readonly query?: string | undefined;
  readonly onCategoryChange: (categoryId: string | undefined) => void;
  /** Urun kartindaki eylem; sayfa verir (bkz. MarketProductGrid). */
  readonly renderProductAction?: (product: Product) => ReactNode;
  readonly texts: MarketPageContent;
  /** "Kategoriler" ve "Tümü" (marketList). */
  readonly navTexts: { readonly title: string; readonly allLabel: string };
}

/**
 * Marketin katalogu (T16.2; referans getircarsi): solda kategoriler, sagda
 * secili kategorinin adi (arama varken "Arama Sonuçları") ve urun izgarasi
 * (imlecle "daha fazla"). Secili kategori ve arama sayfanin adres durumudur
 * (URL); bu bolum onlari yalnizca okur ve kategori degisikligini bildirir.
 */
export function MarketCatalogSection({
  marketId,
  categoryId,
  query,
  onCategoryChange,
  renderProductAction,
  texts,
  navTexts,
}: MarketCatalogSectionProps) {
  const titleId = useId();
  const categories = useMarketCategories(marketId);
  const products = useMarketProducts(marketId, categoryId, query);
  const items = products.data;
  const selected = categories.data?.find((category) => category.id === categoryId);
  const title =
    query !== undefined ? texts.searchResultsTitle : (selected?.name ?? texts.allProductsTitle);

  return (
    <div className={styles['c-market-catalog']}>
      <div className={styles['c-market-catalog__nav']}>
        {categories.data !== undefined && (
          <MarketCategoryNav
            categories={categories.data}
            selectedId={categoryId}
            onSelect={onCategoryChange}
            texts={navTexts}
          />
        )}
        {categories.error !== null && (
          <QueryError error={categories.error} onRetry={() => void categories.refetch()} />
        )}
      </div>

      <section
        className={styles['c-market-catalog__products']}
        aria-labelledby={titleId}
        aria-busy={products.isPending}
      >
        <h2 id={titleId} className={styles['c-market-catalog__title']}>
          {title}
        </h2>
        {products.isPending && <QueryLoading>{texts.productsLoadingLabel}</QueryLoading>}
        {products.error !== null && (
          <QueryError error={products.error} onRetry={() => void products.refetch()} />
        )}
        {items !== undefined && items.length === 0 && (
          <p className={styles['c-market-catalog__empty']}>
            {query === undefined ? texts.categoryEmptyNotice : texts.searchEmptyNotice}
          </p>
        )}
        {items !== undefined && items.length > 0 && (
          <MarketProductGrid
            products={items}
            categories={categories.data}
            texts={texts}
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
            {products.isFetchingNextPage ? texts.loadingMoreLabel : texts.moreLabel}
          </button>
        )}
      </section>
    </div>
  );
}

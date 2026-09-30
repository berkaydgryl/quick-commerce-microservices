import { useParams, useSearchParams } from 'react-router-dom';

import { useAddToCart } from '../../features/cart/hooks/useAddToCart';
import { CartSummary } from '../../features/cart/ui/CartSummary';
import { CartSwitchPrompt } from '../../features/cart/ui/CartSwitchPrompt';
import { ProductCartAction } from '../../features/cart/ui/ProductCartAction';
import { searchQueryFrom } from '../../features/catalog/services/search-query';
import { MarketCatalogSection } from '../../features/catalog/ui/MarketCatalogSection';
import { MarketSearchBox } from '../../features/catalog/ui/MarketSearchBox';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { MarketSummarySection } from '../../features/markets/ui/MarketSummarySection';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import styles from './MarketPage.module.css';

/** Secili kategori ve arama adreste durur: yenileme ve paylasma secimi korur. */
const CATEGORY_PARAM = 'kategori';
const SEARCH_PARAM = 'ara';

/**
 * /markets/:marketId - arama, market basligi, katalogu ve sepet (T6.4). Sayfa
 * BIRLESTIRIR: katalog sepeti, sepet katalogu tanimaz; baglanti burada.
 *
 * Arama BUTUN markette yapilir (T9.5): arama baslayinca kategori "Tumu"ne
 * doner, kategori secilince arama kalkar. Adreste ikisi birden varsa arama
 * gecerlidir.
 */
export function MarketPage() {
  const { marketId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchQueryFrom(searchParams.get(SEARCH_PARAM) ?? '');
  const categoryId =
    query === undefined ? (searchParams.get(CATEGORY_PARAM) ?? undefined) : undefined;

  // Ayni sorgu anahtari: ek istek yok, basligin sorgusunu paylasir. Market
  // bulunamazsa hata YALNIZCA baslikta gorunur.
  const market = useMarket(marketId);
  const cartMarket =
    market.data === undefined ? undefined : { id: market.data.id, name: market.data.name };
  const cart = useAddToCart(cartMarket);

  const selectCategory = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [CATEGORY_PARAM]: next }, { replace: true });
  };

  const search = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [SEARCH_PARAM]: next }, { replace: true });
  };

  return (
    <PageLayout>
      <div className={styles['c-market-page']}>
        <MarketSearchBox query={query} onSearch={search} />
        <MarketSummarySection marketId={marketId} />
        <CartSummary />
        {cart.pending !== undefined && cartMarket !== undefined && (
          <CartSwitchPrompt
            pending={cart.pending}
            targetMarketName={cartMarket.name}
            onConfirm={cart.confirmSwitch}
            onCancel={cart.cancelSwitch}
          />
        )}
        {!market.isError && (
          <MarketCatalogSection
            marketId={marketId}
            categoryId={categoryId}
            query={query}
            onCategoryChange={selectCategory}
            renderProductAction={(product) => (
              <ProductCartAction product={product} onAdd={cart.add} />
            )}
          />
        )}
      </div>
    </PageLayout>
  );
}

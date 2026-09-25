import { useParams, useSearchParams } from 'react-router-dom';

import { useAddToCart } from '../../features/cart/hooks/useAddToCart';
import { CartSummary } from '../../features/cart/ui/CartSummary';
import { CartSwitchPrompt } from '../../features/cart/ui/CartSwitchPrompt';
import { ProductCartAction } from '../../features/cart/ui/ProductCartAction';
import { MarketCatalogSection } from '../../features/catalog/ui/MarketCatalogSection';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { MarketSummarySection } from '../../features/markets/ui/MarketSummarySection';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import styles from './MarketPage.module.css';

/** Secili kategori adreste durur: yenileme ve paylasma secimi korur. */
const CATEGORY_PARAM = 'kategori';

/**
 * /markets/:marketId - market basligi, katalogu ve sepet (T6.4). Sayfa
 * BIRLESTIRIR: katalog sepeti, sepet katalogu tanimaz; baglanti burada.
 */
export function MarketPage() {
  const { marketId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get(CATEGORY_PARAM) ?? undefined;

  // Ayni sorgu anahtari: ek istek yok, basligin sorgusunu paylasir. Market
  // bulunamazsa hata YALNIZCA baslikta gorunur.
  const market = useMarket(marketId);
  const cartMarket =
    market.data === undefined ? undefined : { id: market.data.id, name: market.data.name };
  const cart = useAddToCart(cartMarket);

  const selectCategory = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [CATEGORY_PARAM]: next }, { replace: true });
  };

  return (
    <PageLayout>
      <div className={styles['c-market-page']}>
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

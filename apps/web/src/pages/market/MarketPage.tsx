import { useParams, useSearchParams } from 'react-router-dom';

import { useAddToCart } from '../../features/cart/hooks/useAddToCart';
import { cartPath } from '../../features/cart/routes';
import { productCartTexts } from '../../features/cart/services/product-cart-texts';
import { CartBar } from '../../features/cart/ui/CartBar';
import { CartPanel } from '../../features/cart/ui/CartPanel';
import { CartSwitchDialog } from '../../features/cart/ui/CartSwitchDialog';
import { ProductCartAction } from '../../features/cart/ui/ProductCartAction';
import { searchQueryFrom } from '../../features/catalog/services/search-query';
import { MarketCatalogSection } from '../../features/catalog/ui/MarketCatalogSection';
import { MarketSearchBox } from '../../features/catalog/ui/MarketSearchBox';
import { useFavoritesContent } from '../../features/content/hooks/useFavoritesContent';
import { useMarketListContent } from '../../features/content/hooks/useMarketListContent';
import { useMarketPageContent } from '../../features/content/hooks/useMarketPageContent';
import { FavoriteButton } from '../../features/favorites/ui/FavoriteButton';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { MARKET_PARAMS, marketPath } from '../../features/markets/routes';
import { MarketHeroSection } from '../../features/markets/ui/MarketHeroSection';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import styles from './MarketPage.module.css';

/**
 * /markets/:marketId (T6.4; T16.2'de referans getircarsi isletme sayfasi):
 * solda kapak ve bilgi karti, "Bu işletmede ara…", kategoriler ve urunler;
 * sagda Sepetim paneli (basliksiz), dar ekranda alttaki sepet cubugu. Sayfa
 * BIRLESTIRIR: katalog sepeti, sepet katalogu, markets favorileri tanimaz.
 *
 * Arama BUTUN markette yapilir (T9.5): arama baslayinca kategori "Tumu"ne
 * doner, kategori secilince arama kalkar. Adreste ikisi birden varsa arama
 * gecerlidir. Secili kategori ve arama adreste durur (MARKET_PARAMS):
 * yenileme ve paylasma secimi korur.
 */
export function MarketPage() {
  const { marketId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchQueryFrom(searchParams.get(MARKET_PARAMS.search) ?? '');
  const categoryId =
    query === undefined ? (searchParams.get(MARKET_PARAMS.category) ?? undefined) : undefined;
  const pageTexts = useMarketPageContent();
  const listTexts = useMarketListContent();
  const favoriteTexts = useFavoritesContent();

  // Ayni sorgu anahtari: ek istek yok, basligin sorgusunu paylasir. Market
  // bulunamazsa hata YALNIZCA baslikta gorunur.
  const market = useMarket(marketId);
  const cartMarket =
    market.data === undefined ? undefined : { id: market.data.id, name: market.data.name };
  const cart = useAddToCart(cartMarket);

  const selectCategory = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [MARKET_PARAMS.category]: next }, {
      replace: true,
    });
  };

  const search = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [MARKET_PARAMS.search]: next }, { replace: true });
  };

  if (pageTexts === undefined || listTexts === undefined) {
    return <PageLayout>{null}</PageLayout>;
  }
  const productTexts = productCartTexts(listTexts.cart, pageTexts);

  return (
    <PageLayout>
      <div className={styles['c-market-page']}>
        <div className={styles['c-market-page__main']}>
          <MarketHeroSection
            marketId={marketId}
            pageTexts={pageTexts}
            listTexts={listTexts}
            {...(favoriteTexts === undefined
              ? {}
              : {
                  renderAction: (shown) => (
                    <FavoriteButton market={shown} texts={favoriteTexts} tone="surface" />
                  ),
                })}
          />
          <MarketSearchBox
            query={query}
            onSearch={search}
            label={pageTexts.searchLabel}
            placeholder={pageTexts.searchPlaceholder}
          />
          {cart.pending !== undefined && cartMarket !== undefined && (
            <CartSwitchDialog
              pending={cart.pending}
              targetMarketName={cartMarket.name}
              texts={listTexts.cart}
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
              texts={pageTexts}
              navTexts={{ title: listTexts.categoriesTitle, allLabel: listTexts.allLabel }}
              renderProductAction={(product) => (
                <ProductCartAction
                  product={product}
                  onAdd={cart.add}
                  texts={productTexts}
                  orientation="vertical"
                />
              )}
            />
          )}
        </div>
        <aside className={styles['c-market-page__aside']}>
          <CartPanel
            texts={listTexts.cart}
            marketHref={marketPath}
            cartHref={cartPath}
            titleVisible={false}
          />
        </aside>
      </div>
      <CartBar texts={listTexts.cart} cartHref={cartPath} />
    </PageLayout>
  );
}

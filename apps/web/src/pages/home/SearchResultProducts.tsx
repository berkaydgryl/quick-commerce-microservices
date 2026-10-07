import type { SearchResult } from '@getir/contracts';

import { useAddToCart } from '../../features/cart/hooks/useAddToCart';
import { productCartTexts } from '../../features/cart/services/product-cart-texts';
import { CartSwitchPrompt } from '../../features/cart/ui/CartSwitchPrompt';
import { ProductCartAction } from '../../features/cart/ui/ProductCartAction';
import { MarketProductList } from '../../features/catalog/ui/MarketProductList';
import { useMarketListContent } from '../../features/content/hooks/useMarketListContent';
import { useMarketPageContent } from '../../features/content/hooks/useMarketPageContent';

/**
 * Bir arama kartinin urunleri ve sepet dugmeleri: dugme magaza sayfasindakinin
 * AYNISI (T9.6 karari; T16.2'den beri "+" ve sepet panelinin adet kutusu,
 * burada yatay), satir duzeni kendi (MarketProductList). Sepet tek
 * markettir: sepette baska marketin urunu varken eklenince onay sorusu BU
 * KARTIN icinde cikar. Her kart kendi marketiyle ekler (useAddToCart).
 */
export function SearchResultProducts({ result }: { readonly result: SearchResult }) {
  const market = { id: result.market.id, name: result.market.name };
  const cart = useAddToCart(market);
  const listTexts = useMarketListContent();
  const pageTexts = useMarketPageContent();

  return (
    <>
      {cart.pending !== undefined && (
        <CartSwitchPrompt
          pending={cart.pending}
          targetMarketName={market.name}
          onConfirm={cart.confirmSwitch}
          onCancel={cart.cancelSwitch}
        />
      )}
      <MarketProductList
        products={result.products}
        {...(listTexts === undefined || pageTexts === undefined
          ? {}
          : {
              renderAction: (product) => (
                <ProductCartAction
                  product={product}
                  onAdd={cart.add}
                  texts={productCartTexts(listTexts.cart, pageTexts)}
                />
              ),
            })}
      />
    </>
  );
}

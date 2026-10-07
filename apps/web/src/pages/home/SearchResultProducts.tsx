import type { SearchResult } from '@getir/contracts';
import { useId } from 'react';

import { useAddToCart } from '../../features/cart/hooks/useAddToCart';
import { isMarketClosed } from '../../features/cart/services/cart-state';
import { productCartTexts } from '../../features/cart/services/product-cart-texts';
import { CartSwitchDialog } from '../../features/cart/ui/CartSwitchDialog';
import { ClosedMarketNotice } from '../../features/cart/ui/ClosedMarketNotice';
import { ProductCartAction } from '../../features/cart/ui/ProductCartAction';
import { MarketProductList } from '../../features/catalog/ui/MarketProductList';
import { useMarketListContent } from '../../features/content/hooks/useMarketListContent';
import { useMarketPageContent } from '../../features/content/hooks/useMarketPageContent';

/**
 * Bir arama kartinin urunleri ve sepet dugmeleri: dugme magaza sayfasindakinin
 * AYNISI (T9.6 karari; T16.2'den beri "+" ve sepet panelinin adet kutusu,
 * burada yatay), satir duzeni kendi (MarketProductList). Sepet tek
 * markettir: sepette baska marketin urunu varken eklenince onay sorusu
 * ekranin ortasinda pencerede cikar (CartSwitchDialog; magaza sayfasiyla
 * ayni). Her kart kendi marketiyle ekler (useAddToCart). Market kapaliysa
 * (07.10) urunlerin ustunde tek sebep satiri ve "+" pasif (magaza sayfasiyla ayni).
 */
export function SearchResultProducts({ result }: { readonly result: SearchResult }) {
  const market = { id: result.market.id, name: result.market.name };
  const closed = isMarketClosed(result.market);
  const closedReasonId = useId();
  const cart = useAddToCart(market, closed);
  const listTexts = useMarketListContent();
  const pageTexts = useMarketPageContent();

  return (
    <>
      {cart.pending !== undefined && listTexts !== undefined && (
        <CartSwitchDialog
          pending={cart.pending}
          targetMarketName={market.name}
          texts={listTexts.cart}
          onConfirm={cart.confirmSwitch}
          onCancel={cart.cancelSwitch}
        />
      )}
      {closed && listTexts !== undefined && (
        <ClosedMarketNotice id={closedReasonId} text={listTexts.cart.closedNotice} />
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
                  closed={closed}
                  closedReasonId={closedReasonId}
                />
              ),
            })}
      />
    </>
  );
}

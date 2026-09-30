import type { SearchResult } from '@getir/contracts';

import { useAddToCart } from '../../features/cart/hooks/useAddToCart';
import { CartSwitchPrompt } from '../../features/cart/ui/CartSwitchPrompt';
import { ProductCartAction } from '../../features/cart/ui/ProductCartAction';
import { MarketProductList } from '../../features/catalog/ui/MarketProductList';

/**
 * Bir arama kartinin urunleri ve sepet dugmeleri: market sayfasindaki satir ve
 * dugmenin AYNISI (T9.6 kararlari: "Ekle", adet, "Tukendi"). Sepet tek
 * markettir: sepette baska marketin urunu varken eklenince onay sorusu BU
 * KARTIN icinde cikar. Her kart kendi marketiyle ekler (useAddToCart).
 */
export function SearchResultProducts({ result }: { readonly result: SearchResult }) {
  const market = { id: result.market.id, name: result.market.name };
  const cart = useAddToCart(market);

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
        renderAction={(product) => <ProductCartAction product={product} onAdd={cart.add} />}
      />
    </>
  );
}

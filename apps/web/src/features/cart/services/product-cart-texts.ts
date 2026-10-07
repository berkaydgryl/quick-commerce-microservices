import type { MarketListCartContent, MarketPageContent } from '@getir/contracts';

import type { ProductCartTexts } from '../ui/ProductCartAction';

/**
 * Urunun sepet dugmesinin metinleri (T16.2): adet kutusununkiler sepet
 * panelinden (marketList.cart; ayni kutu, ayni adlar), "+", "Tükendi" ve
 * "Satışta değil" magaza sayfasindan (marketPage). Magaza sayfasi ve ana
 * sayfa aramasi (T9.6) ayni dugmeyi ayni metinlerle cizer.
 */
export function productCartTexts(
  cart: MarketListCartContent,
  page: MarketPageContent,
): ProductCartTexts {
  return {
    decreaseSuffix: cart.decreaseSuffix,
    increaseSuffix: cart.increaseSuffix,
    removeSuffix: cart.removeSuffix,
    quantitySuffix: cart.quantitySuffix,
    addSuffix: page.addSuffix,
    soldOutLabel: page.soldOutLabel,
    unavailableLabel: page.unavailableLabel,
  };
}

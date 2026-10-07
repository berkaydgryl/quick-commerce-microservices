import type { Money, ReserveCartRequest, SavedAddress } from '@getir/contracts';

import type { CartItem } from '../../cart/services/cart-state';

/**
 * Rezervasyon istegi (T12.4): sepetin marketi ve kalemleri, secili HESAP
 * adresinin satiri ve konumu (adres tarifi gitmez; gateway reddeder),
 * beklenen tutar = odeme ozetindeki "Ödenecek Tutar". Sunucunun toplami
 * tutmazsa 409 PRICE_CHANGED.
 */
export function buildReserveRequest(
  marketId: string,
  items: readonly CartItem[],
  address: SavedAddress,
  expectedTotal: Money,
): ReserveCartRequest {
  return {
    marketId,
    items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    address: { line: address.line, location: address.location },
    expectedTotal,
  };
}

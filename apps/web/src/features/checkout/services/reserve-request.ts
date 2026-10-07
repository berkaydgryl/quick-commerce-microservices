import type { Market, Money, ReserveCartRequest, SavedAddress } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';

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

export interface ReservationInputs {
  readonly address: SavedAddress | undefined;
  readonly market: Market | undefined;
  readonly items: readonly CartItem[];
  readonly totals: CartTotals | undefined;
}

/**
 * Rezervasyon alinabilir mi; aliniyorsa istegi (erken rezervasyon, T12.4; PM
 * K4): hesap adresi secili, sepet dolu, market acik, minimum tutuyor ve toplam
 * belli. Kart, hediye ve sozlesme rezervasyonu ETKILEMEZ (yalniz siparise girer).
 */
export function reservationRequestFor({
  address,
  market,
  items,
  totals,
}: ReservationInputs): ReserveCartRequest | undefined {
  if (
    address === undefined ||
    market === undefined ||
    !market.isOpen ||
    totals?.canCheckout !== true ||
    items.length === 0
  ) {
    return undefined;
  }
  return buildReserveRequest(market.id, items, address, {
    amountMinor: totals.totalMinor,
    currency: CURRENCY,
  });
}

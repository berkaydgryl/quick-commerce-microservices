import type {
  CreateOrderRequest,
  Market,
  Money,
  ReserveCartRequest,
  SavedAddress,
  SavedCard,
} from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';

import type { CartItem } from '../../cart/services/cart-state';

import type { CheckoutForm } from './checkout-rules';
import { orderBlocker } from './order-readiness';
import { buildOrderRequest } from './order-request';
import { buildReserveRequest } from './reserve-request';

export interface PrepareOrderInput {
  readonly form: CheckoutForm;
  readonly card: SavedCard | undefined;
  readonly address: SavedAddress | undefined;
  readonly market: Market | undefined;
  readonly items: readonly CartItem[];
  readonly totals: CartTotals | undefined;
  /** Kart kasasi bu pakette acik mi (__CARD_VAULT__). */
  readonly vaultOpen: boolean;
}

export interface PreparedOrder {
  readonly request: ReserveCartRequest;
  readonly orderBody: (orderId: string) => CreateOrderRequest;
}

/**
 * Istek atilmadan HEMEN ONCEKI son kapi (T12.4; QA N3): kart kasasi kapaliysa,
 * kart, hesap adresi, market ya da kurallar yoksa, herhangi bir eksik kosul
 * varsa (hediye hatasi, sozlesme onaysiz, minimum, kapali) undefined: istek
 * ATILMAZ. Dugmenin pasifligine guvenilmez; ayni kosul fonksiyonu (orderBlocker).
 */
export function prepareOrder({
  form,
  card,
  address,
  market,
  items,
  totals,
  vaultOpen,
}: PrepareOrderInput): PreparedOrder | undefined {
  if (
    !vaultOpen ||
    card === undefined ||
    address === undefined ||
    market === undefined ||
    totals === undefined
  ) {
    return undefined;
  }
  const blocker = orderBlocker({
    form,
    cardId: card.id,
    hasAddress: true,
    canCheckout: totals.canCheckout,
    marketOpen: market.isOpen,
  });
  if (blocker !== undefined) {
    return undefined;
  }
  const expectedTotal: Money = { amountMinor: totals.totalMinor, currency: CURRENCY };
  return {
    request: buildReserveRequest(market.id, items, address, expectedTotal),
    orderBody: (orderId) => buildOrderRequest(orderId, card.id, form),
  };
}

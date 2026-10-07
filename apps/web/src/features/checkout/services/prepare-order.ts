import type {
  CreateOrderRequest,
  Market,
  Money,
  ReserveCartRequest,
  SavedAddress,
} from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';

import type { CartItem } from '../../cart/services/cart-state';

import type { CheckoutForm } from './checkout-rules';
import { orderBlocker } from './order-readiness';
import { buildOrderRequest } from './order-request';
import type { PaymentChoice } from './payment-choice';
import { buildReserveRequest } from './reserve-request';

export interface PrepareOrderInput {
  readonly form: CheckoutForm;
  /** Sayfadaki odeme secimi (F12): kart ya da kapida odeme. */
  readonly payment: PaymentChoice | undefined;
  readonly address: SavedAddress | undefined;
  readonly market: Market | undefined;
  readonly items: readonly CartItem[];
  readonly totals: CartTotals | undefined;
  /** Kart kasasi bu pakette acik mi (__CARD_VAULT__): kartla odeme yalnizca acikken. */
  readonly vaultOpen: boolean;
}

export interface PreparedOrder {
  readonly request: ReserveCartRequest;
  readonly orderBody: (orderId: string) => CreateOrderRequest;
}

/**
 * Istek atilmadan HEMEN ONCEKI son kapi (T12.4; QA N3): odeme secilmediyse,
 * kartla odemede kasa kapaliysa (kapida odeme kasasiz da verilir; F12), hesap
 * adresi, market ya da kurallar yoksa, herhangi bir eksik kosul
 * varsa (hediye hatasi, sozlesme onaysiz, minimum, kapali) undefined: istek
 * ATILMAZ. Dugmenin pasifligine guvenilmez; ayni kosul fonksiyonu (orderBlocker).
 */
export function prepareOrder({
  form,
  payment,
  address,
  market,
  items,
  totals,
  vaultOpen,
}: PrepareOrderInput): PreparedOrder | undefined {
  if (
    payment === undefined ||
    (payment.kind === 'card' && !vaultOpen) ||
    address === undefined ||
    market === undefined ||
    totals === undefined
  ) {
    return undefined;
  }
  const blocker = orderBlocker({
    form,
    hasPayment: true,
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
    orderBody: (orderId) => buildOrderRequest(orderId, payment, form),
  };
}

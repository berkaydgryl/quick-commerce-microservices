import type { CheckoutContent, Market, SavedAddress, SavedCard } from '@getir/contracts';
import type { CartTotals } from '@getir/pricing';

import type { CartItem } from '../../cart/services/cart-state';
import type { CheckoutForm } from '../services/checkout-rules';
import { orderBlocker } from '../services/order-readiness';
import type { OrderBlocker } from '../services/order-readiness';
import { prepareOrder } from '../services/prepare-order';
import { reservationRequestFor } from '../services/reserve-request';

import { useOrderFlow } from './useOrderFlow';

interface CheckoutOrderInput {
  readonly form: CheckoutForm;
  readonly card: SavedCard | undefined;
  /** Secili HESAP adresi (varsayilan adreste undefined: siparis verilemez, M7). */
  readonly address: SavedAddress | undefined;
  readonly market: Market | undefined;
  readonly items: readonly CartItem[];
  readonly totals: CartTotals | undefined;
  readonly texts: CheckoutContent;
}

const BLOCKER_TEXT: Record<OrderBlocker, keyof CheckoutContent> = {
  closed: 'blockerClosedNotice',
  minBasket: 'blockerMinBasketNotice',
  gift: 'blockerGiftNotice',
  card: 'blockerCardNotice',
  address: 'blockerAddressNotice',
  reservation: 'blockerReservationNotice',
  agreement: 'blockerAgreementNotice',
};

/**
 * Odeme sayfasinin siparisi (T12.4): ilk eksik kosul ve cumlesi (N1), "Sipariş
 * Ver" ve akisin durumu. Istek atilmadan HEMEN ONCE kosullar yeniden denetlenir
 * (QA N3; prepare-order.ts): kapi kapaliysa istek ATILMAZ, dugmenin
 * pasifligine guvenilmez. Govdede yalnizca cardId (M7).
 */
export function useCheckoutOrder({
  form,
  card,
  address,
  market,
  items,
  totals,
  texts,
}: CheckoutOrderInput) {
  const flow = useOrderFlow(
    market?.id,
    texts,
    reservationRequestFor({ address, market, items, totals }),
  );
  const blocker = orderBlocker({
    form,
    cardId: card?.id,
    hasAddress: address !== undefined,
    canCheckout: totals?.canCheckout === true,
    marketOpen: market?.isOpen === true,
    reservationFailed: flow.reservation.phase.kind === 'failed',
  });

  const place = () => {
    const prepared = prepareOrder({
      form,
      card,
      address,
      market,
      items,
      totals,
      vaultOpen: __CARD_VAULT__,
    });
    if (prepared !== undefined) {
      void flow.place(prepared.request, prepared.orderBody);
    }
  };

  return {
    blockerText: blocker === undefined ? undefined : String(texts[BLOCKER_TEXT[blocker]]),
    flow,
    place,
  };
}

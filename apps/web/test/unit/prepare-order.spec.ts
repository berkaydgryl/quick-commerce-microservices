/**
 * Istekten hemen onceki son kapi (T12.4; QA N3): kart kasasi kapali, kart,
 * hesap adresi, market ya da kurallar yok, hediye hatali ya da sozlesme
 * onaysizsa istek KURULMAZ (dugmenin pasifligine guvenilmez). Hazirsa
 * rezervasyon istegi ve siparis govdesi (yalniz cardId).
 */

import type { SavedAddress, SavedCard } from '@getir/contracts';
import type { CartTotals } from '@getir/pricing';
import { describe, expect, it } from 'vitest';

import type { CartItem } from '../../src/features/cart/services/cart-state';
import { EMPTY_CHECKOUT_FORM } from '../../src/features/checkout/services/checkout-rules';
import { prepareOrder } from '../../src/features/checkout/services/prepare-order';
import type { PrepareOrderInput } from '../../src/features/checkout/services/prepare-order';

import { nearbyMarket } from './market-list-test-support';

const CARD: SavedCard = {
  id: `crd_${'a'.repeat(32)}`,
  brand: 'VISA',
  first4: '4242',
  last4: '1881',
  expiryMonth: 12,
  expiryYear: 2030,
  holderName: 'AYSE YILMAZ',
  expired: false,
  createdAt: '2026-10-01T10:00:00.000Z',
};
const ADDRESS: SavedAddress = {
  id: 'adr_ev',
  title: 'Ev',
  line: 'Moda Cad. No:12',
  location: { lat: 40.98, lng: 29.02 },
};
const ITEM: CartItem = {
  productId: 'prd_sut-1l',
  offerId: 'ofr_a101-sut-1l',
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  unitPriceMinor: 3210,
  quantity: 2,
  maxQuantity: 2,
};
const TOTALS: CartTotals = {
  subtotalMinor: 6420,
  discountMinor: 0,
  deliveryFeeMinor: 1990,
  totalMinor: 8410,
  canCheckout: true,
  amountToMinBasketMinor: 0,
  amountToFreeDeliveryMinor: 0,
  coupon: null,
};
const READY: PrepareOrderInput = {
  form: { ...EMPTY_CHECKOUT_FORM, agreementsAccepted: true },
  card: CARD,
  address: ADDRESS,
  market: nearbyMarket({ id: 'mkt_a101', name: 'A101', brand: 'A101', meters: 100 }).market,
  items: [ITEM],
  totals: TOTALS,
  vaultOpen: true,
};
const ORDER_ID = `ord_${'b'.repeat(32)}`;

describe('prepareOrder (T12.4, QA N3)', () => {
  it('hazir: rezervasyon istegi (beklenen tutar = Ödenecek Tutar) ve siparis govdesi (yalniz cardId)', () => {
    const prepared = prepareOrder(READY);

    expect(prepared?.request).toEqual({
      marketId: 'mkt_a101',
      items: [{ productId: 'prd_sut-1l', quantity: 2 }],
      address: { line: 'Moda Cad. No:12', location: { lat: 40.98, lng: 29.02 } },
      expectedTotal: { amountMinor: 8410, currency: 'TRY' },
    });
    expect(prepared?.orderBody(ORDER_ID).payment).toEqual({ method: 'CARD', cardId: CARD.id });
  });

  it('kart kasasi kapali (production paketi): istek kurulmaz', () => {
    expect(prepareOrder({ ...READY, vaultOpen: false })).toBeUndefined();
  });

  it('kart, adres, market ya da kurallar yok: istek kurulmaz', () => {
    expect(prepareOrder({ ...READY, card: undefined })).toBeUndefined();
    expect(prepareOrder({ ...READY, address: undefined })).toBeUndefined();
    expect(prepareOrder({ ...READY, market: undefined })).toBeUndefined();
    expect(prepareOrder({ ...READY, totals: undefined })).toBeUndefined();
  });

  it('sozlesme onaysiz, hediye hatali, minimum tutmuyor ya da market kapali: istek kurulmaz', () => {
    expect(prepareOrder({ ...READY, form: EMPTY_CHECKOUT_FORM })).toBeUndefined();
    expect(
      prepareOrder({
        ...READY,
        form: { ...READY.form, gift: { ...READY.form.gift, enabled: true } },
      }),
    ).toBeUndefined();
    expect(prepareOrder({ ...READY, totals: { ...TOTALS, canCheckout: false } })).toBeUndefined();
    expect(prepareOrder({ ...READY, market: { ...READY.market!, isOpen: false } })).toBeUndefined();
  });
});

/**
 * Siparis akisinin saf parcalari (T12.4): siparis govdesi (sozlesmenin
 * createOrderRequestSchema'si; yalniz cardId, hediye kapaliyken gift YOK - QA
 * N3), "Sipariş Ver"in ilk eksik kosulu (N1), rezervasyon istegi (adresin yalniz
 * satiri ve konumu), 3DS geri sayimi (rezervasyonun ve kodun SUNUCU sureleri,
 * son 30 saniye uyari - T17.1; PM K1) ve tutulan siparisin gecerliligi (K2).
 */

import type { SavedAddress } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import type { CartItem } from '../../src/features/cart/services/cart-state';
import { EMPTY_CHECKOUT_FORM } from '../../src/features/checkout/services/checkout-rules';
import type { CheckoutForm } from '../../src/features/checkout/services/checkout-rules';
import {
  challengeDeadline,
  formatCountdown,
  isCountdownWarning,
  remainingSeconds,
} from '../../src/features/checkout/services/countdown';
import {
  canReuseHeldOrder,
  heldFingerprint,
} from '../../src/features/checkout/services/held-order';
import { buildOrderRequest } from '../../src/features/checkout/services/order-request';
import { orderBlocker } from '../../src/features/checkout/services/order-readiness';
import type { ReadinessInput } from '../../src/features/checkout/services/order-readiness';
import { buildReserveRequest } from '../../src/features/checkout/services/reserve-request';

const ORDER_ID = `ord_${'b'.repeat(32)}`;
const CARD_ID = `crd_${'a'.repeat(32)}`;
const READY_FORM: CheckoutForm = { ...EMPTY_CHECKOUT_FORM, agreementsAccepted: true };
const GIFT_FORM: CheckoutForm = {
  ...READY_FORM,
  note: '  Kapıda bekleyin  ',
  doNotRingBell: true,
  gift: {
    enabled: true,
    message: ' İyi ki doğdun! ',
    senderName: ' Ayşe ',
    recipientName: ' Deneme Alıcı ',
    recipientPhone: '5321234567',
  },
};

describe('buildOrderRequest (T12.4, B1/B2; sozlesmenin semasi)', () => {
  it('hediye KAPALI: govdede gift alani YOK (QA N3); odeme yalnizca cardId', () => {
    const draft = buildOrderRequest(ORDER_ID, CARD_ID, {
      ...READY_FORM,
      gift: { ...GIFT_FORM.gift, enabled: false },
    });

    expect(draft).toEqual({
      orderId: ORDER_ID,
      payment: { method: 'CARD', cardId: CARD_ID },
      details: { note: '', doNotRingBell: false, agreementsAccepted: true },
    });
    expect('gift' in draft.details).toBe(false);
  });

  it('hediye ACIK: alanlar kirpilir, telefon E.164; not ve "Zili Çalma" gider', () => {
    expect(buildOrderRequest(ORDER_ID, CARD_ID, GIFT_FORM).details).toEqual({
      gift: {
        enabled: true,
        message: 'İyi ki doğdun!',
        senderName: 'Ayşe',
        recipientName: 'Deneme Alıcı',
        recipientPhone: '+905321234567',
      },
      note: 'Kapıda bekleyin',
      doNotRingBell: true,
      agreementsAccepted: true,
    });
  });

  it('M7: govdede kart numarasi ya da CVV yok; yalnizca kasanin kimligi', () => {
    const json = JSON.stringify(buildOrderRequest(ORDER_ID, CARD_ID, GIFT_FORM));

    // Alan adlari ve kart numarasi boyunda (15-16 hane) rakam dizisi yok; telefon 12 hane.
    expect(json).not.toMatch(/"(?:cvv|cardNumber|pan|number)"/i);
    expect(json).not.toMatch(/\d{15,}/);
    expect(json).toContain(CARD_ID);
  });

  it('sozlesme onaysiz ya da gecersiz kart kimligiyle govde KURULMAZ', () => {
    expect(() => buildOrderRequest(ORDER_ID, CARD_ID, EMPTY_CHECKOUT_FORM)).toThrow();
    expect(() => buildOrderRequest(ORDER_ID, '4242424242424242', READY_FORM)).toThrow();
  });

  it('not sinirini (UTF-16 birimi, QA N2) asan govde kurulmaz', () => {
    expect(() =>
      buildOrderRequest(ORDER_ID, CARD_ID, { ...READY_FORM, note: '😀'.repeat(126) }),
    ).toThrow();
    expect(() =>
      buildOrderRequest(ORDER_ID, CARD_ID, { ...READY_FORM, note: '😀'.repeat(125) }),
    ).not.toThrow();
  });
});

describe('orderBlocker (T12.4, N1)', () => {
  const ready: ReadinessInput = {
    form: READY_FORM,
    cardId: CARD_ID,
    hasAddress: true,
    canCheckout: true,
    marketOpen: true,
  };

  it('hepsi tamam: engel yok', () => {
    expect(orderBlocker(ready)).toBeUndefined();
  });

  it('ilk eksik doner: kapali > minimum > hediye > kart > adres > sozlesme', () => {
    expect(orderBlocker({ ...ready, marketOpen: false, canCheckout: false })).toBe('closed');
    expect(orderBlocker({ ...ready, canCheckout: false, cardId: undefined })).toBe('minBasket');
    expect(
      orderBlocker({
        ...ready,
        form: { ...READY_FORM, gift: { ...READY_FORM.gift, enabled: true } },
      }),
    ).toBe('gift');
    expect(orderBlocker({ ...ready, cardId: undefined, hasAddress: false })).toBe('card');
    expect(orderBlocker({ ...ready, hasAddress: false })).toBe('address');
    expect(orderBlocker({ ...ready, form: EMPTY_CHECKOUT_FORM })).toBe('agreement');
  });
});

describe('buildReserveRequest (T12.4)', () => {
  it('kalemler urun kimligi ve adediyle; adresin yalnizca satiri ve konumu; beklenen tutar', () => {
    const item: CartItem = {
      productId: 'prd_sut-1l',
      offerId: 'ofr_a101-sut-1l',
      sku: 'SUT-1L',
      name: 'Süt 1 L',
      unitPriceMinor: 3210,
      quantity: 2,
      maxQuantity: 2,
    };
    const address: SavedAddress = {
      id: 'adr_ev',
      title: 'Ev',
      line: 'Moda Cad. No:12',
      location: { lat: 40.98, lng: 29.02 },
      note: 'Zili çalma',
      floor: '2',
    };

    expect(
      buildReserveRequest('mkt_a101', [item], address, { amountMinor: 8410, currency: 'TRY' }),
    ).toEqual({
      marketId: 'mkt_a101',
      items: [{ productId: 'prd_sut-1l', quantity: 2 }],
      address: { line: 'Moda Cad. No:12', location: { lat: 40.98, lng: 29.02 } },
      expectedTotal: { amountMinor: 8410, currency: 'TRY' },
    });
  });
});

describe('3DS geri sayimi (T12.4, T17.1)', () => {
  it('son an: kodun ve rezervasyonun SUNUCU surelerinden kisa olani', () => {
    expect(
      challengeDeadline({
        reservationReceivedAt: 0,
        reservationTtlSeconds: 600,
        challengeReceivedAt: 2000,
        challengeTtlSeconds: 60,
      }),
    ).toBe(62_000);
    expect(
      challengeDeadline({
        reservationReceivedAt: 0,
        reservationTtlSeconds: 45,
        challengeReceivedAt: 2000,
        challengeTtlSeconds: 60,
      }),
    ).toBe(45_000);
  });

  it('K1: kodun suresi gelmezse YALNIZ rezervasyon suresi (60 sn tahmini yok)', () => {
    expect(
      challengeDeadline({
        reservationReceivedAt: 0,
        reservationTtlSeconds: 600,
        challengeReceivedAt: 2000,
        challengeTtlSeconds: undefined,
      }),
    ).toBe(600_000);
  });

  it('rezervasyon suresi gelmezse kodun suresi; ikisi de yoksa son an yok (sayac gosterilmez)', () => {
    expect(
      challengeDeadline({
        reservationReceivedAt: 0,
        reservationTtlSeconds: undefined,
        challengeReceivedAt: 1000,
        challengeTtlSeconds: 90,
      }),
    ).toBe(91_000);
    expect(
      challengeDeadline({
        reservationReceivedAt: 0,
        reservationTtlSeconds: undefined,
        challengeReceivedAt: 1000,
        challengeTtlSeconds: undefined,
      }),
    ).toBeUndefined();
  });

  it('kalan saniye yukari yuvarlanir, sifirin alti yok', () => {
    expect(remainingSeconds(60_000, 0)).toBe(60);
    expect(remainingSeconds(60_000, 30_001)).toBe(30);
    expect(remainingSeconds(60_000, 59_999)).toBe(1);
    expect(remainingSeconds(60_000, 70_000)).toBe(0);
  });

  it('uyari son 30 saniyede (31 degil, 30 ve 1 evet, 0 sure doldu)', () => {
    expect([31, 30, 1, 0].map(isCountdownWarning)).toEqual([false, true, true, false]);
  });

  it('bicim "1:00", "0:29", "0:05"', () => {
    expect([60, 29, 5].map(formatCountdown)).toEqual(['1:00', '0:29', '0:05']);
  });
});

describe('tutulan siparis (kart 404; PM K2)', () => {
  const item: CartItem = {
    productId: 'prd_sut-1l',
    offerId: 'ofr_a101-sut-1l',
    sku: 'SUT-1L',
    name: 'Süt 1 L',
    unitPriceMinor: 3210,
    quantity: 1,
    maxQuantity: 5,
  };
  const address: SavedAddress = {
    id: 'adr_ev',
    title: 'Ev',
    line: 'Moda Cad. No:12',
    location: { lat: 40.98, lng: 29.02 },
  };
  const request = buildReserveRequest('mkt_a101', [item], address, {
    amountMinor: 3210,
    currency: 'TRY',
  });
  const held = {
    orderId: ORDER_ID,
    fingerprint: heldFingerprint(request),
    reservationReceivedAt: 1000,
    reservationTtlSeconds: 600,
  };

  it('ayni sepet, adres ve tutar; sure dolmamis: yeniden verilebilir', () => {
    expect(canReuseHeldOrder(held, request, 1000 + 599_000)).toBe(true);
  });

  it('sure dolduysa ya da istek degistiyse: yeniden verilemez (birakilip bastan)', () => {
    expect(canReuseHeldOrder(held, request, 1000 + 600_000)).toBe(false);
    const changed = { ...request, expectedTotal: { amountMinor: 9000, currency: 'TRY' as const } };
    expect(canReuseHeldOrder(held, changed, 2000)).toBe(false);
  });

  it('sunucu sure bildirmediyse sure kurali yok (siparis ucu karar verir)', () => {
    expect(
      canReuseHeldOrder({ ...held, reservationTtlSeconds: undefined }, request, 10_000_000),
    ).toBe(true);
  });
});

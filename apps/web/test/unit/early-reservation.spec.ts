/**
 * Erken rezervasyon (T12.4; PM K4): odeme sayfasi acikken sepet ayrilir;
 * kosul (adres, sepet, acik market, minimum, toplam), degisince birak ve
 * yeniden al, sure dolunca sessizce yeniden al, kosul kalkinca birak, siparis
 * verildiyse ASLA dokunma ve ayrilinca birakma (PM ek sarti). Ozet kartindaki
 * kalan sure (son 60 sn uyari) ve kart 404'unden tutulan sipariste yontem ya
 * da ayrinti degisimi (QA #176 N2).
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type {
  CreateOrderRequest,
  Market,
  ReserveCartRequest,
  SavedAddress,
} from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import type { CartTotals } from '@getir/pricing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CartItem } from '../../src/features/cart/services/cart-state';
import { EMPTY_CHECKOUT_FORM } from '../../src/features/checkout/services/checkout-rules';
import { isReservationWarning } from '../../src/features/checkout/services/countdown';
import {
  heldFingerprint,
  heldMatchesBody,
  orderBodyFingerprint,
} from '../../src/features/checkout/services/held-order';
import type { HeldOrder } from '../../src/features/checkout/services/held-order';
import { orderBlocker } from '../../src/features/checkout/services/order-readiness';
import {
  releasableOnLeave,
  reservationStep,
} from '../../src/features/checkout/services/reservation-plan';
import type { ReservationPhase } from '../../src/features/checkout/services/reservation-plan';
import { reservationRequestFor } from '../../src/features/checkout/services/reserve-request';
import { ReservationStatus } from '../../src/features/checkout/ui/ReservationStatus';

import { nearbyMarket } from './market-list-test-support';

const ORDER_ID = `ord_${'c'.repeat(32)}`;
const TEXTS = CONTENT_FALLBACK.checkout;
const ITEM: CartItem = {
  productId: 'prd_sut-1l',
  offerId: 'ofr_a101-sut-1l',
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  unitPriceMinor: 3210,
  quantity: 2,
  maxQuantity: 5,
};
const ADDRESS: SavedAddress = {
  id: 'adr_ev',
  title: 'Ev',
  line: 'Moda Cad. No:12',
  location: { lat: 40.98, lng: 29.02 },
};
const MARKET: Market = nearbyMarket({
  id: 'mkt_a101',
  name: 'A101',
  brand: 'A101',
  meters: 200,
}).market;
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
const REQUEST = reservationRequestFor({
  address: ADDRESS,
  market: MARKET,
  items: [ITEM],
  totals: TOTALS,
});
const OTHER: ReserveCartRequest = {
  ...(REQUEST as ReserveCartRequest),
  expectedTotal: { amountMinor: 9000, currency: 'TRY' },
};
const held = (overrides: Partial<HeldOrder> = {}): HeldOrder => ({
  orderId: ORDER_ID,
  fingerprint: heldFingerprint(REQUEST as ReserveCartRequest),
  reservationReceivedAt: 1_000,
  reservationTtlSeconds: 600,
  ...overrides,
});
const HELD: ReservationPhase = { kind: 'held', held: held() };
const ORDERED: ReservationPhase = { kind: 'ordered', orderId: ORDER_ID };

describe('reservationRequestFor: ne zaman ayrilir', () => {
  it('adres, sepet, acik market, minimum ve toplam varsa istek (beklenen tutar = Ödenecek Tutar)', () => {
    expect(REQUEST).toEqual({
      marketId: 'mkt_a101',
      items: [{ productId: 'prd_sut-1l', quantity: 2 }],
      address: { line: 'Moda Cad. No:12', location: { lat: 40.98, lng: 29.02 } },
      expectedTotal: { amountMinor: 8410, currency: 'TRY' },
    });
  });

  it('kosul eksikse istek YOK: adres, market kapali, minimum, bos sepet, toplam yok', () => {
    const base = { address: ADDRESS, market: MARKET, items: [ITEM], totals: TOTALS };
    expect(reservationRequestFor({ ...base, address: undefined })).toBeUndefined();
    expect(
      reservationRequestFor({ ...base, market: { ...MARKET, isOpen: false } }),
    ).toBeUndefined();
    expect(
      reservationRequestFor({ ...base, totals: { ...TOTALS, canCheckout: false } }),
    ).toBeUndefined();
    expect(reservationRequestFor({ ...base, items: [] })).toBeUndefined();
    expect(reservationRequestFor({ ...base, totals: undefined })).toBeUndefined();
  });
});

describe('reservationStep: siradaki is', () => {
  it('rezervasyon yoksa al; istek suruyorsa bekle', () => {
    expect(reservationStep({ kind: 'none' }, REQUEST, 0)).toBe('reserve');
    expect(reservationStep({ kind: 'reserving', fingerprint: 'x' }, OTHER, 0)).toBe('wait');
  });

  it('sepet, adres ya da tutar degisince eskisini birak, yenisini al', () => {
    expect(reservationStep(HELD, OTHER, 2_000)).toBe('replace');
  });

  it('sure dolunca sessizce yeniden al; dolmadiysa bekle; sure bilinmiyorsa bekle', () => {
    expect(reservationStep(HELD, REQUEST, 1_000 + 599_999)).toBe('wait');
    expect(reservationStep(HELD, REQUEST, 1_000 + 600_000)).toBe('renew');
    expect(
      reservationStep(
        { kind: 'held', held: held({ reservationTtlSeconds: undefined }) },
        REQUEST,
        1e9,
      ),
    ).toBe('wait');
  });

  it('kosul kalkinca (sepet bosaldi, market kapandi) birak', () => {
    expect(reservationStep(HELD, undefined, 2_000)).toBe('release');
    expect(reservationStep({ kind: 'none' }, undefined, 2_000)).toBe('wait');
  });

  it('hata: ayni istekle bekle (Tekrar dene), istek degisince yeniden dene', () => {
    const failed: ReservationPhase = {
      kind: 'failed',
      fingerprint: heldFingerprint(REQUEST as ReserveCartRequest),
      error: new Error('stok'),
    };
    expect(reservationStep(failed, REQUEST, 0)).toBe('wait');
    expect(reservationStep(failed, OTHER, 0)).toBe('reserve');
  });

  it('PM ek sarti: siparis verildiyse (PAID, REVIEW, 3DS) ASLA dokunulmaz: degisim, sure, kosul kalksa da', () => {
    expect(reservationStep(ORDERED, OTHER, 1e12)).toBe('wait');
    expect(reservationStep(ORDERED, undefined, 1e12)).toBe('wait');
    expect(reservationStep(ORDERED, REQUEST, 1e12)).toBe('wait');
  });
});

describe('releasableOnLeave: sayfadan ayrilinca', () => {
  it('yalnizca siparisi VERILMEMIS rezervasyon birakilir', () => {
    expect(releasableOnLeave(HELD)).toEqual(held());
    expect(releasableOnLeave(ORDERED)).toBeUndefined();
    expect(releasableOnLeave({ kind: 'none' })).toBeUndefined();
    expect(releasableOnLeave({ kind: 'failed', fingerprint: 'x', error: null })).toBeUndefined();
  });
});

describe('kart 404 sonrasi tutulan siparis: yontem ve ayrintilar (QA #176 N2)', () => {
  const body = (
    overrides: Partial<CreateOrderRequest['details']> = {},
    cardId = `crd_${'a'.repeat(32)}`,
  ) =>
    ({
      orderId: ORDER_ID,
      payment: { method: 'CARD', cardId },
      details: { note: '', doNotRingBell: false, agreementsAccepted: true, ...overrides },
    }) as CreateOrderRequest;

  it('yalniz rezervasyon (siparis hic verilmedi): her govdeyle kullanilir', () => {
    expect(heldMatchesBody(held(), body({ note: 'Herhangi' }))).toBe(true);
  });

  it('degismediyse AYNI orderId (yalniz kart degisti); not ya da hediye degistiyse YENI siparis', () => {
    const placed = held({ placedWith: orderBodyFingerprint(body()) });

    expect(heldMatchesBody(placed, body({}, `crd_${'d'.repeat(32)}`))).toBe(true);
    expect(heldMatchesBody(placed, body({ note: 'Kapıda bekle' }))).toBe(false);
  });

  it('kart degisimi parmak izini DEGISTIRMEZ (yeni kartla ayni siparis); not ya da zil degistirir', () => {
    expect(orderBodyFingerprint(body({}, `crd_${'d'.repeat(32)}`))).toBe(
      orderBodyFingerprint(body()),
    );
    expect(orderBodyFingerprint(body({ note: 'Kapıda bekle' }))).not.toBe(
      orderBodyFingerprint(body()),
    );
    expect(orderBodyFingerprint(body({ doNotRingBell: true }))).not.toBe(
      orderBodyFingerprint(body()),
    );
  });
});

describe('kalan sure ve kosul', () => {
  it('rezervasyonun uyarisi son 60 saniyede (61 degil, 60 ve 1 evet, 0 sure doldu)', () => {
    expect([61, 60, 1, 0].map((seconds) => isReservationWarning(seconds))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('rezervasyon hatasi "Sipariş Ver"i durdurur (adresten sonra, sozlesmeden once)', () => {
    const ready = {
      form: { ...EMPTY_CHECKOUT_FORM, agreementsAccepted: true },
      hasPayment: true,
      hasAddress: true,
      canCheckout: true,
      marketOpen: true,
    };
    expect(orderBlocker(ready)).toBeUndefined();
    expect(orderBlocker({ ...ready, reservationFailed: true })).toBe('reservation');
    expect(orderBlocker({ ...ready, hasAddress: false, reservationFailed: true })).toBe('address');
  });
});

describe('ReservationStatus (ozet karti)', () => {
  const status = (phase: ReservationPhase) =>
    renderToStaticMarkup(
      createElement(ReservationStatus, { phase, texts: TEXTS, onRetry: () => undefined }),
    );
  const live = (ttlSeconds: number) =>
    status({
      kind: 'held',
      held: held({ reservationReceivedAt: performance.now(), reservationTtlSeconds: ttlSeconds }),
    });

  it('ayrildi: "Ürünlerin 2:05 boyunca senin için ayrıldı." (sayac role=timer, uyari yok)', () => {
    const html = live(125);

    expect(html.replace(/<[^>]+>/g, '')).toContain('Ürünlerin 2:05 boyunca senin için ayrıldı.');
    expect(html).toMatch(/role="timer"[^>]*>2:05</);
    expect(html).not.toContain('is-warning');
  });

  it('son dakika: uyari sinifi ve ekran okuyucuya "Son 1 dakika"', () => {
    const html = live(45);

    expect(html).toContain('is-warning');
    expect(html).toMatch(/aria-live="polite">Son 1 dakika</);
  });

  it('istek suruyor: "Ürünlerin ayrılıyor…" (role=status); hata: sunucunun cumlesi ve "Tekrar dene"', () => {
    expect(status({ kind: 'reserving', fingerprint: 'x' })).toMatch(
      /role="status">Ürünlerin ayrılıyor…</,
    );
    const failed = status({
      kind: 'failed',
      fingerprint: 'x',
      error: new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Süt 1 L için yeterli stok yok.'),
    });
    expect(failed).toContain('role="status"');
    expect(failed).toContain('Süt 1 L için yeterli stok yok.');
    expect(failed).toContain('>Tekrar dene</button>');
  });

  it('siparis verildiyse ya da rezervasyon yoksa satir yok', () => {
    expect(status(ORDERED)).toBe('');
    expect(status({ kind: 'none' })).toBe('');
  });
});

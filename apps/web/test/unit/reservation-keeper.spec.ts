/**
 * Rezervasyonun fazi ve sayfadan ayrilma (T12.4; QA K9 #178 F1): siparis
 * istegi UCUSTAYKEN ya da sonucu belirsizken sayfadan ayrilmak rezervasyonu
 * BIRAKMAZ (siparis sunucuda olusmus olabilir); yalniz siparisi verilmemis
 * rezervasyon birakilir. Kart 404'unden tutulan siparis uymuyorsa birakilir;
 * belirsiz siparis uymuyorsa birakilmaz. Kapida odemenin turu parmak izinde
 * (QA #178 N2).
 */

import type { CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../../src/shared/api/http-client';
import { createAttemptKeys } from '../../src/features/cards/services/attempt-key';
import {
  heldFingerprint,
  orderBodyFingerprint,
} from '../../src/features/checkout/services/held-order';
import type { HeldOrder } from '../../src/features/checkout/services/held-order';
import type { OrderFlowDeps } from '../../src/features/checkout/services/place-order';
import { createReservationKeeper } from '../../src/features/checkout/services/reservation-keeper';
import { reservationStep } from '../../src/features/checkout/services/reservation-plan';
import type { ReservationPhase } from '../../src/features/checkout/services/reservation-plan';
import { createReserveIntent } from '../../src/features/checkout/services/reserve-intent';

const ORDER_ID = `ord_${'c'.repeat(32)}`;
const REQUEST: ReserveCartRequest = {
  marketId: 'mkt_a101',
  items: [{ productId: 'prd_sut-1l', quantity: 1 }],
  address: { line: 'Moda Cad. No:12', location: { lat: 40.98, lng: 29.02 } },
  expectedTotal: { amountMinor: 5200, currency: 'TRY' },
};
const CHANGED: ReserveCartRequest = {
  ...REQUEST,
  expectedTotal: { amountMinor: 6000, currency: 'TRY' },
};
const BODY = (orderId: string, note = ''): CreateOrderRequest => ({
  orderId,
  payment: { method: 'CARD', cardId: `crd_${'a'.repeat(32)}` },
  details: { note, doNotRingBell: false, agreementsAccepted: true },
});
const HELD: HeldOrder = {
  orderId: ORDER_ID,
  fingerprint: heldFingerprint(REQUEST),
  reservationReceivedAt: 1_000,
  reservationTtlSeconds: 600,
};

/** Birakma istegini kaydeden sahte istemci (DELETE 200). */
function setup() {
  const deletes: string[] = [];
  const client: HttpClient = {
    request<T>(path: string): Promise<T> {
      deletes.push(path);
      return Promise.resolve({
        orderId: ORDER_ID,
        released: true,
        releasedAt: '2026-10-07T05:00:00.000Z',
      } as T);
    },
  };
  let fresh = 0;
  const deps: OrderFlowDeps = {
    client,
    now: () => 2_000,
    reserveIntent: createReserveIntent(() => 'niyet'),
    orderAttempts: createAttemptKeys(() => 'deneme'),
    newKey: () => `yeni-${(fresh += 1)}`,
  };
  const phases: ReservationPhase[] = [];
  const keeper = createReservationKeeper(deps, (phase) => phases.push(phase));
  return { keeper, deletes, phases };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('QA K9 #178 F1: ucustaki siparisin rezervasyonu birakilmaz', () => {
  it('"Sipariş Ver" rezervasyonu alir (placing); cevap gelmeden sayfadan ayrilinca DELETE YOK', async () => {
    const { keeper, deletes } = setup();
    keeper.set({ kind: 'held', held: HELD });

    await expect(keeper.take(REQUEST, BODY)).resolves.toEqual(HELD);
    expect(keeper.phase()).toEqual({ kind: 'placing', held: HELD });
    keeper.leave();
    await settle();

    expect(deletes).toEqual([]);
  });

  it('sonuc belirsiz (placing): ayrilinca DELETE YOK; ayni rezervasyonla yeniden denenir', async () => {
    const { keeper, deletes } = setup();
    keeper.set({ kind: 'placing', held: HELD });

    keeper.leave();
    await settle();
    expect(deletes).toEqual([]);
    await expect(keeper.take(REQUEST, BODY)).resolves.toEqual(HELD);
  });

  it('siparis verildi (ordered): ayrilinca DELETE YOK', async () => {
    const { keeper, deletes } = setup();
    keeper.set({ kind: 'ordered', orderId: ORDER_ID });

    keeper.leave();
    await settle();
    expect(deletes).toEqual([]);
  });

  it('siparisi verilmemis rezervasyon (held): ayrilinca BIRAKILIR (yeni anahtarla DELETE)', async () => {
    const { keeper, deletes } = setup();
    keeper.set({ kind: 'held', held: HELD });

    keeper.leave();
    await settle();
    expect(deletes).toEqual([`/v1/cart/reserve/${ORDER_ID}`]);
  });

  it('karar katmani: placing ve ordered fazinda hicbir is yapilmaz (sure dolsa, kosul kalksa da)', () => {
    const placing: ReservationPhase = { kind: 'placing', held: HELD };

    expect(reservationStep(placing, CHANGED, 1e12)).toBe('wait');
    expect(reservationStep(placing, undefined, 1e12)).toBe('wait');
  });
});

describe('uymayan rezervasyon: birakilir mi', () => {
  it('kart 404 sonrasi tutulan (held, placedWith) ayrinti degisince: BIRAKILIR, undefined', async () => {
    const { keeper, deletes } = setup();
    keeper.set({
      kind: 'held',
      held: { ...HELD, placedWith: orderBodyFingerprint(BODY(ORDER_ID)) },
    });

    await expect(keeper.take(REQUEST, (id) => BODY(id, 'Kapıda bekle'))).resolves.toBeUndefined();
    expect(keeper.phase()).toEqual({ kind: 'none' });
    expect(deletes).toEqual([`/v1/cart/reserve/${ORDER_ID}`]);
  });

  it('belirsiz siparis (placing) uymuyorsa (sepet degisti): BIRAKILMAZ, undefined (yeni rezervasyon alinir)', async () => {
    const { keeper, deletes } = setup();
    keeper.set({ kind: 'placing', held: HELD });

    await expect(keeper.take(CHANGED, BODY)).resolves.toBeUndefined();
    expect(keeper.phase()).toEqual({ kind: 'none' });
    expect(deletes).toEqual([]);
  });
});

describe('QA #178 N2: kapida odemenin turu parmak izinde', () => {
  const cod = (onDelivery: 'CASH' | 'POS'): CreateOrderRequest => ({
    orderId: ORDER_ID,
    payment: { method: 'CASH_ON_DELIVERY', onDelivery },
    details: { note: '', doNotRingBell: false, agreementsAccepted: true },
  });

  it('nakit ve kapida kart AYRI parmak izi (sunucu degisimi 409 ile reddeder); kartli govde etkilenmez', () => {
    expect(orderBodyFingerprint(cod('CASH'))).not.toBe(orderBodyFingerprint(cod('POS')));
    expect(orderBodyFingerprint(BODY(ORDER_ID))).toBe(
      JSON.stringify({
        method: 'CARD',
        details: { note: '', doNotRingBell: false, agreementsAccepted: true },
      }),
    );
  });
});

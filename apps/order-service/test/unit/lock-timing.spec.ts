/**
 * Kilidin suresi saga'da (T11.3; roadmap "Bantlar ve aksiyonlar", B21, #72):
 * risk bandina gore kilit (uc band icin ayri test, roadmap kabul olcutu), odeme
 * ve 3DS denemesinden once uzatma, kilit dusmusse para cekilmemesi. Bellek
 * deposu, sahte risk, odeme ve inventory; inventory'nin saati siparisin saatiyle
 * ayni (sahte saat).
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createConfirmPayment } from '../../src/application/confirm-payment.js';
import { createCreateOrder } from '../../src/application/create-order.js';
import type { ExtendTiming } from '../../src/application/stock-reservations.js';
import { PAYMENT_METHOD } from '../../src/domain/checkout-payment.js';
import type { Order } from '../../src/domain/order.js';
import {
  needsLockExtension,
  rescheduleReservation,
  shortensLock,
  withReservationExpiry,
} from '../../src/domain/stock-reservation.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { FakeStockReservations, TEST_LOCK_POLICY } from '../support/fake-stock-reservations.js';
import {
  insertAwaitingPayment,
  insertDraft,
  SAMPLE_ITEM,
  SAMPLE_RESERVATION_TTL_MS,
} from '../support/order-builders.js';

const DRAFT_AT_MS = 1_760_000_000_000;
const SECOND = 1_000;
const MEDIUM_MS = TEST_LOCK_POLICY.mediumRiskSeconds * SECOND;
const EXTEND_MS = TEST_LOCK_POLICY.extendSeconds * SECOND;
const byCard = { method: PAYMENT_METHOD.CARD, cardToken: TEST_CARD.APPROVED } as const;
const cashOnDelivery = { method: PAYMENT_METHOD.CASH_ON_DELIVERY } as const;
const lines = [{ sku: SAMPLE_ITEM.sku, quantity: SAMPLE_ITEM.quantity }];

let clock: ReturnType<typeof fixedClock>;
let repository: InMemoryOrderStore;
let risk: FakeRiskAssessment;
let payments: FakePayments;
let stock: FakeStockReservations;
let logLines: LogLine[];
let scope: { requestId: string; logger: ReturnType<typeof recordingLogger> };
let create: ReturnType<typeof createCreateOrder>;
let confirm: ReturnType<typeof createConfirmPayment>;

beforeEach(() => {
  clock = fixedClock(DRAFT_AT_MS);
  repository = new InMemoryOrderStore();
  risk = new FakeRiskAssessment();
  payments = new FakePayments();
  stock = new FakeStockReservations(() => clock.now());
  logLines = [];
  scope = { requestId: 'req_kilit_1', logger: recordingLogger(logLines) };
  const deps = {
    repository,
    history: repository,
    risk,
    payments,
    stock,
    outbox: repository,
    clock,
    lockPolicy: TEST_LOCK_POLICY,
  };
  create = createCreateOrder(deps);
  confirm = createConfirmPayment(deps);
});

/** Kilitli taslak (10 dk) ve inventory'deki ayni kilit. */
async function lockedDraft(): Promise<Order> {
  const draft = await insertDraft(repository, clock);
  stock.hold(draft.id, draft.userId, lines, expiryOf(draft));
  return draft;
}

function expiryOf(order: Order | null | undefined): Date {
  const expiresAt = order?.reservation?.expiresAt;
  if (expiresAt === undefined) throw new Error('siparisin kilidi yok');
  return expiresAt;
}

async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error(`siparis yok: ${orderId}`);
  return order;
}

const place = (order: Order, choice: typeof byCard | typeof cashOnDelivery = byCard) =>
  create({ orderId: order.id, userId: order.userId, ...choice }, scope);

describe('banda gore kilit (T11.3, uc band icin ayri test)', () => {
  it('LOW: kilit taslaktaki gibi kalir; inventory ye kisaltma gitmez; kapida odeme acik', async () => {
    const draft = await lockedDraft();
    clock.advance(45 * SECOND);

    const { order } = await place(draft, cashOnDelivery);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(stock.shortens).toEqual([]);
    expect(stock.extends).toEqual([]);
    expect(expiryOf(await stored(draft.id))).toEqual(expiryOf(draft));
  });

  it('MEDIUM: kilit risk adiminda 2 dk ya iner; yeni bitis risk karariyla AYNI yazimda (olay yalnizca gecisler)', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const draft = await lockedDraft();
    clock.advance(45 * SECOND);
    const shortenedTo = new Date(clock.now() + MEDIUM_MS);

    const { order, challengeId } = await place(draft);

    expect(stock.shortens).toEqual([
      { orderId: draft.id, marketId: draft.marketId, maxRemainingSeconds: 120 },
    ]);
    expect(challengeId).toBeDefined();
    expect(order.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    const saved = await stored(draft.id);
    expect(expiryOf(saved)).toEqual(shortenedTo);
    expect(stock.expiryOf(draft.id)).toEqual(shortenedTo);
    // RISK_CHECK, RESERVED, AWAITING_PAYMENT: uc gecis, uc surum; kisaltma ayri surum almaz.
    expect(saved.version).toBe(draft.version + 3);
    expect(repository.recordedEvents.map((event) => event.topic)).toEqual([
      'order.created',
      'order.status_changed',
      'order.status_changed',
      'order.status_changed',
    ]);
  });

  it('MEDIUM ama kalan sure zaten 2 dk dan kisa: kilit oldugu gibi (asla uzamaz)', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const draft = await lockedDraft();
    clock.set(expiryOf(draft).getTime() - 90 * SECOND);

    await place(draft);

    expect(expiryOf(await stored(draft.id))).toEqual(expiryOf(draft));
  });

  it.each([
    [RISK_BANDS.HIGH, ORDER_STATUS.REVIEW, ERROR_CODES.RISK_REVIEW, 'risk_review'],
    [RISK_BANDS.CRITICAL, ORDER_STATUS.REJECTED, ERROR_CODES.RISK_BLOCKED, 'risk_rejected'],
  ] as [RiskBand, string, string, string][])(
    '%s: siparis %s, %s; kilit KISALTILMAZ, birakilir (%s); odeme yok',
    async (band, status, code, reason) => {
      risk.band = band;
      const draft = await lockedDraft();

      await expect(place(draft)).rejects.toMatchObject({ code, details: { status } });

      expect(stock.shortens).toEqual([]);
      expect(stock.releases).toEqual([{ orderId: draft.id, marketId: draft.marketId, reason }]);
      expect(payments.charges).toEqual([]);
    },
  );

  it('MEDIUM + kilit dusmus: siparis CANCELLED (RESERVATION_EXPIRED, 410), odeme asamasina GECMEZ, cekim yok', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const draft = await lockedDraft();
    stock.expire(draft.id);

    await expect(place(draft)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { orderId: draft.id, status: ORDER_STATUS.CANCELLED },
    });

    const saved = await stored(draft.id);
    expect(saved.timeline.map((entry) => [entry.status, entry.note])).toEqual([
      [ORDER_STATUS.DRAFT, undefined],
      [ORDER_STATUS.CANCELLED, ERROR_CODES.RESERVATION_EXPIRED],
    ]);
    expect(payments.charges).toEqual([]);
  });

  it('MEDIUM + inventory ulasilamaz: HICBIR SEY yazilmaz (risk karari da), siparis DRAFT, cekim yok', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const draft = await lockedDraft();
    stock.shortenFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory kapali');

    await expect(place(draft)).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });

    expect(await stored(draft.id)).toEqual(draft);
    expect(payments.charges).toEqual([]);
  });
});

describe('odeme oncesi uzatma (T11.3, B21, #72)', () => {
  it('kalan sure 60 sn ve ustu: inventory ye uzatma GITMEZ (CreateOrder zaman butcesi degismez)', async () => {
    const draft = await lockedDraft();
    clock.set(expiryOf(draft).getTime() - EXTEND_MS);

    await place(draft);

    expect(stock.extends).toEqual([]);
  });

  it('kalan sure 60 sn nin altinda: CEKIMDEN ONCE +60 sn, yeni bitis cekimden once KAYITLI; siparis PAID', async () => {
    const draft = await lockedDraft();
    clock.set(expiryOf(draft).getTime() - 30 * SECOND);
    const extendedTo = new Date(expiryOf(draft).getTime() + EXTEND_MS);
    const expiryAtCharge: (Date | undefined)[] = [];
    const charge = payments.charge.bind(payments);
    vi.spyOn(payments, 'charge').mockImplementation(async (request) => {
      expiryAtCharge.push((await repository.findById(request.orderId))?.reservation?.expiresAt);
      return charge(request);
    });

    const { order } = await place(draft);

    expect(stock.extends).toEqual([
      {
        orderId: draft.id,
        marketId: draft.marketId,
        additionalSeconds: 60,
        expectedExpiresAt: expiryOf(draft),
      },
    ]);
    expect(expiryAtCharge).toEqual([extendedTo]);
    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(expiryOf(order)).toEqual(extendedTo);
    expect(logLines.map((line) => line.message)).toContain('odeme oncesi stok kilidi uzatildi');
    // Cagiran denetimi saglikli uzatmada sessiz kalir (T15.3).
    expect(logLines.filter((line) => line.level === 'error')).toEqual([]);
  });

  it('kaybolan cevapli uzatma (T15.3): kilit zaten ileride; hak HARCANMAZ, guncel bitis yazilir, cekim yapilir', async () => {
    const draft = await lockedDraft();
    clock.set(expiryOf(draft).getTime() - 30 * SECOND);
    const alreadyExtendedTo = new Date(expiryOf(draft).getTime() + EXTEND_MS);
    stock.forceExpiry(draft.id, alreadyExtendedTo);

    const { order } = await place(draft);

    expect(stock.extends.map((request) => request.expectedExpiresAt)).toEqual([expiryOf(draft)]);
    expect(stock.extensionsOf(draft.id)).toBe(0);
    expect(expiryOf(await stored(draft.id))).toEqual(alreadyExtendedTo);
    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(logLines.map((line) => line.message)).toContain(
      'stok kilidinin bitisi siparistekinden farkliydi; guncel bitis yazildi',
    );
  });

  it('kaydedilmemis kisaltma (T15.3): guncel bitis de kisa; yazilir ve yeni beklenenle bir tur daha uzatilir', async () => {
    const draft = await lockedDraft();
    clock.set(expiryOf(draft).getTime() - 30 * SECOND);
    const shortenedTo = new Date(expiryOf(draft).getTime() - 10 * SECOND);
    stock.forceExpiry(draft.id, shortenedTo);

    const { order } = await place(draft);

    expect(stock.extends.map((request) => request.expectedExpiresAt)).toEqual([
      expiryOf(draft),
      shortenedTo,
    ]);
    expect(stock.extensionsOf(draft.id)).toBe(1);
    expect(expiryOf(order)).toEqual(new Date(shortenedTo.getTime() + EXTEND_MS));
  });

  it('cagiran denetimi (T15.3): beklenen bitisi uygulamayan (eski) inventory HATA gunlugune duser', async () => {
    const draft = await lockedDraft();
    clock.set(expiryOf(draft).getTime() - 30 * SECOND);
    stock.forceExpiry(draft.id, new Date(expiryOf(draft).getTime() + EXTEND_MS));
    stock.ignoresExpectedExpiry = true;

    const { order } = await place(draft);

    expect(logLines.find((line) => line.level === 'error')?.message).toBe(
      'stok servisi beklenen bitis denetimini uygulamamis olabilir (eski surum?)',
    );
    // Uyari akisi durdurmaz: donen bitis yazilir, cekim yapilir.
    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(expiryOf(order)).toEqual(new Date(expiryOf(draft).getTime() + 2 * EXTEND_MS));
  });

  /** Ilk tur `moved` (kilit kisaltilmis, kalan 20 sn); ikinci turu `second` belirler. */
  async function movedThen(second: () => Promise<ExtendTiming>) {
    const draft = await lockedDraft();
    clock.set(expiryOf(draft).getTime() - 30 * SECOND);
    const shortenedTo = new Date(expiryOf(draft).getTime() - 10 * SECOND);
    stock.forceExpiry(draft.id, shortenedTo);
    const real = stock.extend.bind(stock);
    vi.spyOn(stock, 'extend').mockImplementationOnce(real).mockImplementationOnce(second);
    return { draft, shortenedTo };
  }

  it('moved sonra kilit dusmus: siparis GUNCEL surumle iptal edilir (CANCELLED), para cekilmez', async () => {
    const { draft } = await movedThen(() => Promise.resolve({ kind: 'lapsed' }));

    await expect(place(draft)).rejects.toMatchObject({ code: ERROR_CODES.RESERVATION_EXPIRED });
    expect((await stored(draft.id)).status).toBe(ORDER_STATUS.CANCELLED);
    expect(payments.charges).toEqual([]);
  });

  it('moved sonra hak bitmis: guncel bitis yazili kalir, UYARI; cekim kalan sureyle', async () => {
    const { draft, shortenedTo } = await movedThen(() =>
      Promise.resolve({ kind: 'active', expiresAt: shortenedTo, changed: false }),
    );

    const { order } = await place(draft);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(expiryOf(await stored(draft.id))).toEqual(shortenedTo);
    expect(logLines.find((line) => line.level === 'warn')?.message).toBe(
      'stok kilidi uzatilamadi: uzatma hakki bitti; odeme kalan sureyle',
    );
  });

  it('moved sonra inventory ulasilamaz: hata yukari gider; ilk turda yazilan guncel bitis KALIR', async () => {
    const { draft, shortenedTo } = await movedThen(() =>
      Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory kapali')),
    );

    await expect(place(draft)).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(expiryOf(await stored(draft.id))).toEqual(shortenedTo);
  });

  it('iki tur da moved: turlar biter, UYARI; cekim guncel bitisle', async () => {
    const { draft, shortenedTo } = await movedThen(() =>
      Promise.resolve({ kind: 'moved', expiresAt: new Date(shortenedTo.getTime() + SECOND) }),
    );

    const { order } = await place(draft);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(expiryOf(order)).toEqual(new Date(shortenedTo.getTime() + SECOND));
    expect(logLines.find((line) => line.level === 'warn')?.message).toBe(
      'stok kilidinin bitisi iki turda da kaydi; odeme guncel bitisle',
    );
  });

  it('uzatma hakki bitmis: sure ayni, UYARI; cekim kalan sureyle yapilir', async () => {
    const draft = await lockedDraft();
    stock.maxExtensions = 0;
    clock.set(expiryOf(draft).getTime() - 30 * SECOND);

    const { order } = await place(draft);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(expiryOf(await stored(draft.id))).toEqual(expiryOf(draft));
    expect(logLines.find((line) => line.level === 'warn')?.message).toBe(
      'stok kilidi uzatilamadi: uzatma hakki bitti; odeme kalan sureyle',
    );
  });

  it('kilit dusmus: para CEKILMEZ; siparis CANCELLED + RESERVATION_EXPIRED (onceden: cekim + iade)', async () => {
    const awaiting = await insertAwaitingPayment(repository, clock);
    clock.set(expiryOf(awaiting).getTime() - 30 * SECOND);
    stock.expire(awaiting.id);

    await expect(place(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
    });

    expect(payments.charges).toEqual([]);
    expect(payments.refunds).toEqual([]);
    const saved = await stored(awaiting.id);
    expect(saved.status).toBe(ORDER_STATUS.CANCELLED);
    expect(saved.timeline.at(-1)?.note).toBe(ERROR_CODES.RESERVATION_EXPIRED);
  });

  it('inventory ulasilamaz: hata yukari, cekim yok, siparis degismez', async () => {
    const awaiting = await insertAwaitingPayment(repository, clock);
    clock.set(expiryOf(awaiting).getTime() - 30 * SECOND);
    stock.extendFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory kapali');

    await expect(place(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });

    expect(payments.charges).toEqual([]);
    expect(await stored(awaiting.id)).toEqual(awaiting);
  });

  it('3DS beklerken (durum degismez) uzatma kaydi surumu artirir: eski haliyle yazan supurucu CONFLICT alir', async () => {
    const awaiting = await insertAwaitingPayment(repository, clock, RISK_BANDS.MEDIUM);
    // Kilit siparisin bildigi bitisle (T15.3): uzatma yolu sinanir, moved degil.
    stock.hold(awaiting.id, awaiting.userId, lines, expiryOf(awaiting));
    clock.set(expiryOf(awaiting).getTime() - 30 * SECOND);

    const { order, challengeId } = await place(awaiting);
    expect(stock.extensionsOf(awaiting.id)).toBe(1);

    expect(challengeId).toBeDefined();
    expect(order.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    const saved = await stored(awaiting.id);
    expect(saved.version).toBe(awaiting.version + 1);
    expect(saved.timeline).toEqual(awaiting.timeline);
    await expect(
      repository.update({ ...awaiting, status: ORDER_STATUS.CANCELLED }, awaiting.version, []),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });
});

describe('3DS onayi oncesi uzatma (T11.3)', () => {
  async function awaitingThreeDs(remainingMs: number): Promise<Order> {
    const awaiting = await insertAwaitingPayment(repository, clock, RISK_BANDS.MEDIUM);
    stock.hold(awaiting.id, awaiting.userId, lines, expiryOf(awaiting));
    clock.set(expiryOf(awaiting).getTime() - remainingMs);
    return awaiting;
  }
  const confirmOf = (order: Order) =>
    confirm(
      { orderId: order.id, userId: order.userId, challengeId: 'tds_1', code: '123456' },
      scope,
    );

  it('kalan sure kisa: onaydan ONCE uzatilir; kod payment-svc ye gider, siparis PAID', async () => {
    const awaiting = await awaitingThreeDs(20 * SECOND);

    const order = await confirmOf(awaiting);

    expect(stock.extends).toHaveLength(1);
    expect(payments.confirmations).toHaveLength(1);
    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(expiryOf(order)).toEqual(new Date(expiryOf(awaiting).getTime() + EXTEND_MS));
  });

  it('kilit dusmus: kod payment-svc ye GITMEZ; siparis CANCELLED + 410 (iptal komutu 3DS bekleyeni kapatir)', async () => {
    const awaiting = await awaitingThreeDs(20 * SECOND);
    stock.expire(awaiting.id);

    await expect(confirmOf(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
    });

    expect(payments.confirmations).toEqual([]);
    expect(repository.recordedEvents.map((event) => event.topic)).toContain(
      'payment.cancel_requested',
    );
  });
});

describe('kilit zamani kurallari (domain)', () => {
  const NOW = new Date(DRAFT_AT_MS);
  const order = (expiresInMs: number | null): Order =>
    ({
      id: 'ord_1',
      version: 4,
      updatedAt: NOW,
      ...(expiresInMs === null
        ? {}
        : {
            reservation: {
              reservedAt: NOW,
              expiresAt: new Date(NOW.getTime() + expiresInMs),
            },
          }),
    }) as Order;

  it('yalnizca orta bant kilidi kisaltir', () => {
    expect(
      [RISK_BANDS.LOW, RISK_BANDS.MEDIUM, RISK_BANDS.HIGH, RISK_BANDS.CRITICAL].map(shortensLock),
    ).toEqual([false, true, false, false]);
  });

  it('uzatma gerekli mi: kalan sure pencereden AZ ise; kilitsiz eski siparis hic', () => {
    expect(needsLockExtension(order(59_999), NOW, EXTEND_MS)).toBe(true);
    expect(needsLockExtension(order(60_000), NOW, EXTEND_MS)).toBe(false);
    expect(needsLockExtension(order(-1), NOW, EXTEND_MS)).toBe(true);
    expect(needsLockExtension(order(null), NOW, EXTEND_MS)).toBe(false);
  });

  it('yeni bitis: risk adiminda surum AYNI; tek basina yazilirken surum +1 ve updatedAt', () => {
    const later = new Date(NOW.getTime() + SAMPLE_RESERVATION_TTL_MS);
    const at = new Date(NOW.getTime() + 5_000);

    expect(withReservationExpiry(order(1_000), later)).toMatchObject({
      version: 4,
      reservation: { reservedAt: NOW, expiresAt: later },
    });
    expect(rescheduleReservation(order(1_000), later, at)).toMatchObject({
      version: 5,
      updatedAt: at,
      reservation: { reservedAt: NOW, expiresAt: later },
    });
    expect(withReservationExpiry(order(null), later).reservation).toBeUndefined();
  });
});

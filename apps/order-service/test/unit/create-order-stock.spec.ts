/**
 * CreateOrder saga'sinda stok kilidi (T11.2): kilidi dusmus taslak ilerlemez,
 * saga durursa kilit birakilir, odeme alininca kilit PAID'den ONCE kesinlesir.
 * Kesinlestirme sirasinda kilit dusmusse para iade edilir, siparis iptal olur.
 * Inventory sahtedir; depoya dogrudan yazilan taslagin kilidi var sayilir.
 */

import {
  AppError,
  ERROR_CODES,
  fixedClock,
  ORDER_STATUS,
  RISK_BANDS,
  silentLogger,
} from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCreateOrder } from '../../src/application/create-order.js';
import { SETTLEMENT } from '../../src/application/stock-reservations.js';
import { PAYMENT_METHOD } from '../../src/domain/checkout-payment.js';
import type { Order } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const DRAFT_AT_MS = 1_760_000_000_000;
/** Taslak ile "siparisi ver" arasi; kilit 10 dk, yani hala gecerli. */
const DWELL_MS = 45_000;
const draftClock = fixedClock(DRAFT_AT_MS);
const scope = { requestId: 'req_stok_1', logger: silentLogger };
const byCard = (cardToken: string = TEST_CARD.APPROVED) =>
  ({ method: PAYMENT_METHOD.CARD, cardToken }) as const;
const cashOnDelivery = { method: PAYMENT_METHOD.CASH_ON_DELIVERY } as const;

let repository: InMemoryOrderStore;
let risk: FakeRiskAssessment;
let payments: FakePayments;
let stock: FakeStockReservations;
let create: ReturnType<typeof createCreateOrder>;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  risk = new FakeRiskAssessment();
  payments = new FakePayments();
  stock = new FakeStockReservations();
  create = createCreateOrder({
    repository,
    history: repository,
    risk,
    payments,
    stock,
    outbox: repository,
    clock: fixedClock(DRAFT_AT_MS + DWELL_MS),
  });
});

/** Siparisi kaydedilmis haliyle okur (yoksa test duser). */
async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error(`siparis yok: ${orderId}`);
  return order;
}

function lastNoteOf(order: Order): [OrderStatus, string | undefined] {
  const last = order.timeline.at(-1);
  return [order.status, last?.note];
}

describe('CreateOrder - kilit kesinlesir', () => {
  it('mutlu yol: kilit PAID yazilmadan ONCE kesinlesir, birakma yok', async () => {
    const { id, marketId } = await insertDraft(repository, draftClock);
    const statusAtCommit: (OrderStatus | undefined)[] = [];
    const commit = vi.spyOn(stock, 'commit').mockImplementation(async (request) => {
      statusAtCommit.push((await repository.findById(request.orderId))?.status);
      return SETTLEMENT.APPLIED;
    });

    const { order } = await create({ orderId: id, userId: 'usr_1', ...byCard() }, scope);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(statusAtCommit).toEqual([ORDER_STATUS.AWAITING_PAYMENT]);
    expect(commit).toHaveBeenCalledWith({ orderId: id, marketId }, scope);
    expect(stock.releases).toEqual([]);
  });

  it('kapida odemede de kilit kesinlesir (siparis PAID, cekim sonra)', async () => {
    const { id } = await insertDraft(repository, draftClock);

    await create({ orderId: id, userId: 'usr_1', ...cashOnDelivery }, scope);

    expect(stock.commits.map((commit) => commit.orderId)).toEqual([id]);
  });

  it('checkout-dwell kilidin alindigi andan olculur (reservedAt, roadmap T11.2)', async () => {
    const { id } = await insertDraft(
      repository,
      draftClock,
      {},
      {
        reservation: {
          reservedAt: new Date(DRAFT_AT_MS + 15_000),
          expiresAt: new Date(DRAFT_AT_MS + 615_000),
        },
      },
    );

    await create({ orderId: id, userId: 'usr_1', ...byCard() }, scope);

    expect(risk.contexts[0]?.checkoutDwellMs).toBe(DWELL_MS - 15_000);
  });

  it('T11.2 oncesi acilmis, kilitsiz odeme bekleyen siparis kesinlestirilmeden PAID olur', async () => {
    const { id } = await insertAwaitingPayment(repository, draftClock, RISK_BANDS.LOW, {
      reservation: null,
    });

    const { order } = await create({ orderId: id, userId: 'usr_1', ...byCard() }, scope);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(stock.commits).toEqual([]);
  });
});

describe('CreateOrder - kilidi dusmus taslak (karar: iptal + 410)', () => {
  it.each([
    [
      'suresi dolmus',
      { reservedAt: new Date(DRAFT_AT_MS), expiresAt: new Date(DRAFT_AT_MS + 30_000) },
    ],
    ['hic kilidi olmayan (T11.2 oncesi)', null],
  ])(
    '%s taslak: CANCELLED (RESERVATION_EXPIRED), kilit birakilir; risk sorulmaz, odeme alinmaz',
    async (_name, reservation) => {
      const { id, marketId } = await insertDraft(repository, draftClock, {}, { reservation });

      await expect(
        create({ orderId: id, userId: 'usr_1', ...byCard() }, scope),
      ).rejects.toMatchObject({
        code: ERROR_CODES.RESERVATION_EXPIRED,
        details: { orderId: id, status: ORDER_STATUS.CANCELLED },
      });
      expect(lastNoteOf(await stored(id))).toEqual([
        ORDER_STATUS.CANCELLED,
        ERROR_CODES.RESERVATION_EXPIRED,
      ]);
      const released =
        reservation === null ? [] : [{ orderId: id, marketId, reason: 'reservation_expired' }];
      expect(stock.releases).toEqual(released);
      expect(risk.contexts).toEqual([]);
      expect(payments.charges).toEqual([]);
    },
  );

  it('iptal sistemin: risk gecmisinde kullanicinin iptali SAYILMAZ', async () => {
    const { id } = await insertDraft(repository, draftClock, {}, { reservation: null });
    await create({ orderId: id, userId: 'usr_1', ...byCard() }, scope).catch(() => undefined);

    await expect(repository.riskHistory('usr_1')).resolves.toMatchObject({ cancelledCount: 0 });
  });
});

describe('CreateOrder - saga durursa kilit birakilir', () => {
  it.each([
    [RISK_BANDS.HIGH, 'risk_review'],
    [RISK_BANDS.CRITICAL, 'risk_rejected'],
  ])('%s: kilit birakilir (%s), kesinlestirme yok', async (band, reason) => {
    risk.band = band;
    const { id, marketId } = await insertDraft(repository, draftClock);

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard() }, scope),
    ).rejects.toBeInstanceOf(AppError);

    expect(stock.releases).toEqual([{ orderId: id, marketId, reason }]);
    expect(stock.commits).toEqual([]);
  });

  it('kart reddi: PAYMENT_FAILED ve kilit birakilir (payment_failed)', async () => {
    const { id, marketId } = await insertDraft(repository, draftClock);

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.DECLINED) }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_DECLINED });

    expect(stock.releases).toEqual([{ orderId: id, marketId, reason: 'payment_failed' }]);
    expect(stock.commits).toEqual([]);
  });

  it('birakma basarisizsa saga yine sonuclanir: istemci kendi hatasini alir (kilit suresi dolunca doner)', async () => {
    stock.releaseFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory yok');
    const { id } = await insertDraft(repository, draftClock);

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.DECLINED) }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_DECLINED });
    expect((await stored(id)).status).toBe(ORDER_STATUS.PAYMENT_FAILED);
  });

  it('MEDIUM + kapida odeme: siparis DRAFT kalir, kilit KORUNUR (kartla yeniden dener)', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const { id } = await insertDraft(repository, draftClock);

    await expect(
      create({ orderId: id, userId: 'usr_1', ...cashOnDelivery }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED });

    expect(stock.releases).toEqual([]);
  });

  it('3DS bekleyen sipariste kilit KORUNUR', async () => {
    const { id } = await insertDraft(repository, draftClock);

    await create({ orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.CHALLENGE) }, scope);

    expect(stock.releases).toEqual([]);
    expect(stock.commits).toEqual([]);
  });
});

describe('CreateOrder - kilit odeme sirasinda dustu (Commit NOT_FOUND)', () => {
  it('kartla: tutar IADE edilir (reservation_expired), siparis CANCELLED, istemciye RESERVATION_EXPIRED', async () => {
    const { id } = await insertDraft(repository, draftClock);
    stock.expire(id);

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard() }, scope),
    ).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { orderId: id, status: ORDER_STATUS.CANCELLED },
    });

    expect(payments.refunds).toEqual([
      { orderId: id, reason: 'reservation_expired', idempotencyKey: `refund-${id}` },
    ]);
    expect(lastNoteOf(await stored(id))).toEqual([
      ORDER_STATUS.CANCELLED,
      ERROR_CODES.RESERVATION_EXPIRED,
    ]);
  });

  it('kapida odeme: cekim yok, iade de yok; siparis CANCELLED', async () => {
    const { id } = await insertDraft(repository, draftClock);
    stock.expire(id);

    await expect(
      create({ orderId: id, userId: 'usr_1', ...cashOnDelivery }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESERVATION_EXPIRED });

    expect(payments.refunds).toEqual([]);
    expect((await stored(id)).status).toBe(ORDER_STATUS.CANCELLED);
  });
});

describe('CreateOrder - kesinlestirme gecici hata verdi', () => {
  it("inventory'ye ulasilamazsa siparis AWAITING_PAYMENT kalir, iade yok; tekrarda ayni anahtarla cekilir ve kesinlesir", async () => {
    const { id } = await insertDraft(repository, draftClock);
    stock.commitFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory yok');

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard() }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect((await stored(id)).status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(payments.refunds).toEqual([]);

    stock.commitFailure = undefined;
    const { order } = await create({ orderId: id, userId: 'usr_1', ...byCard() }, scope);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(payments.charges.map((charge) => charge.idempotencyKey)).toEqual([
      `charge-${id}`,
      `charge-${id}`,
    ]);
    expect(stock.commits).toHaveLength(2);
  });
});

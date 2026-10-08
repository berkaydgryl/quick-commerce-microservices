/**
 * CreateOrder saga'si (T7.1), ODEME adimi ve TELAFI: bellek deposu, sahte risk
 * ve odeme. Roadmap olcutu: "Kart reddinde siparis PAYMENT_FAILED".
 */

import {
  AppError,
  ERROR_CODES,
  EVENTS,
  fixedClock,
  ORDER_STATUS,
  RISK_BANDS,
  silentLogger,
} from '@getir/core';
import type { Logger } from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCreateOrder } from '../../src/application/create-order.js';
import { PAYMENT_METHOD } from '../../src/domain/checkout-payment.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeStockReservations, TEST_LOCK_POLICY } from '../support/fake-stock-reservations.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);
const byCard = (cardToken: string) => ({ method: PAYMENT_METHOD.CARD, cardToken }) as const;

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
    clock,
    lockPolicy: TEST_LOCK_POLICY,
  });
});

function scopeWith(logger: Logger = silentLogger) {
  return { requestId: 'req_odeme_1', logger };
}

/** Siparisi kaydedilmis haliyle okur (yoksa test duser). */
async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error(`siparis yok: ${orderId}`);
  return order;
}

describe('CreateOrder - odeme sonucu', () => {
  it('kart reddi: siparis PAYMENT_FAILED (not PAYMENT_DECLINED), istemciye PAYMENT_DECLINED', async () => {
    const { id } = await insertDraft(repository, clock);

    const failing = create(
      { orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.DECLINED) },
      scopeWith(),
    );

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({
      code: ERROR_CODES.PAYMENT_DECLINED,
      details: { orderId: id, status: ORDER_STATUS.PAYMENT_FAILED },
    });
    const order = await stored(id);
    expect(order.status).toBe(ORDER_STATUS.PAYMENT_FAILED);
    expect(order.timeline.at(-1)?.note).toBe('PAYMENT_DECLINED');
    // Cekim yapilmadi: iade (telafi) yok.
    expect(payments.refunds).toEqual([]);
  });

  it('3DS karti: siparis odeme bekler, challengeId doner', async () => {
    const { id } = await insertDraft(repository, clock);

    const result = await create(
      { orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.CHALLENGE) },
      scopeWith(),
    );

    expect(result.challengeId).toBe('tds_sahte_dogrulama');
    expect((await stored(id)).status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
  });
});

describe('CreateOrder - tekrar deneme (cekim cevabi kayboldu)', () => {
  it('payment-svc kapaliyken siparis AWAITING_PAYMENT kalir; tekrarda risk sorulmaz, AYNI anahtarla cekilir', async () => {
    const { id } = await insertDraft(repository, clock);
    payments.chargeFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) }, scopeWith()),
    ).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect((await stored(id)).status).toBe(ORDER_STATUS.AWAITING_PAYMENT);

    payments.chargeFailure = undefined;
    const { order } = await create(
      { orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) },
      scopeWith(),
    );

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(risk.contexts).toHaveLength(1);
    expect(payments.charges.map((charge) => charge.idempotencyKey)).toEqual([
      `charge-${id}`,
      `charge-${id}`,
    ]);
  });

  it('tekrar denemede kayitli bandin kurali gecerli: secimi kayitsiz (eski) MEDIUM siparis kapida odemeye donemez', async () => {
    const { id } = await insertAwaitingPayment(repository, clock, RISK_BANDS.MEDIUM);

    await expect(
      create(
        { orderId: id, userId: 'usr_1', method: PAYMENT_METHOD.CASH_ON_DELIVERY },
        scopeWith(),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED });
    expect(payments.charges).toEqual([]);
  });

  it('odeme bekleyen sipariste yontem degisirse CONFLICT (T12.4): kartla baslayan kapida odemeye donemez', async () => {
    const { id } = await insertDraft(repository, clock);
    payments.chargeFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    await create(
      { orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) },
      scopeWith(),
    ).catch(() => undefined);
    payments.chargeFailure = undefined;

    await expect(
      create(
        { orderId: id, userId: 'usr_1', method: PAYMENT_METHOD.CASH_ON_DELIVERY },
        scopeWith(),
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { orderId: id, field: 'paymentMethod' },
    });
    expect(payments.charges).toHaveLength(1);
  });

  it('kartli cekim hala PENDING (es zamanli istek suruyor): REQUEST_IN_PROGRESS, siparis degismez', async () => {
    const { id } = await insertDraft(repository, clock);
    payments.chargeFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    await create(
      { orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) },
      scopeWith(),
    ).catch(() => undefined);
    payments.chargeFailure = undefined;
    const before = await stored(id);
    vi.spyOn(payments, 'charge').mockResolvedValueOnce({ status: 'PENDING' });

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) }, scopeWith()),
    ).rejects.toMatchObject({ code: ERROR_CODES.REQUEST_IN_PROGRESS });
    await expect(stored(id)).resolves.toEqual(before);
  });

  it('bandsiz eski siparis (T7.1 oncesi) riski atlayarak cekilmez: ORDER_STATE_INVALID', async () => {
    const draft = await insertDraft(repository, clock);
    const legacy = [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
    ].reduce((order: Order, status) => transitionOrder(order, status, clock), draft);
    await repository.update(legacy, draft.version, []);

    await expect(
      create({ orderId: draft.id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) }, scopeWith()),
    ).rejects.toMatchObject({ code: ERROR_CODES.ORDER_STATE_INVALID });
    expect(payments.charges).toEqual([]);
  });
});

describe('CreateOrder - telafi (P3: PAID yazilamazsa iade)', () => {
  /** Cekim sirasinda kullanici siparisi iptal eder (B29: AWAITING_PAYMENT iptal edilebilir). */
  function cancelDuringCharge(orderId: string): void {
    payments.beforeChargeReturns = async () => {
      const current = await stored(orderId);
      await repository.update(
        transitionOrder(current, ORDER_STATUS.CANCELLED, clock, 'USER_CANCELLED'),
        current.version,
        [],
      );
    };
  }

  it('cekim basarili ama siparis ayni anda iptal edildi: tutar IADE edilir, CONFLICT doner', async () => {
    const { id } = await insertDraft(repository, clock);
    cancelDuringCharge(id);

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) }, scopeWith()),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(payments.refunds).toEqual([
      { orderId: id, reason: 'order_changed_during_payment', idempotencyKey: `refund-${id}` },
    ]);
    expect((await stored(id)).status).toBe(ORDER_STATUS.CANCELLED);
  });

  it('cakismayi ayni odemenin es zamanli tekrari yazdiysa (siparis PAID) iade YAPILMAZ', async () => {
    const { id } = await insertDraft(repository, clock);
    payments.beforeChargeReturns = async () => {
      const current = await stored(id);
      await repository.update(
        transitionOrder(current, ORDER_STATUS.PAID, clock),
        current.version,
        [],
      );
    };

    const { order } = await create(
      { orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) },
      scopeWith(),
    );

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(payments.refunds).toEqual([]);
  });

  it('kapida odemede cakisma: cekim yok, iade de yok', async () => {
    const { id } = await insertDraft(repository, clock);
    cancelDuringCharge(id);

    await expect(
      create(
        { orderId: id, userId: 'usr_1', method: PAYMENT_METHOD.CASH_ON_DELIVERY },
        scopeWith(),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(payments.refunds).toEqual([]);
  });

  it('dogrudan iade basarisizsa iade KOMUTU outbox a yazilir (T7.3); istemci yine CONFLICT alir', async () => {
    const { id } = await insertDraft(repository, clock);
    cancelDuringCharge(id);
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');

    await expect(
      create({ orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) }, scopeWith()),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });

    const commands = repository.recordedEvents.filter(
      (event) => event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.payload).toEqual({
      orderId: id,
      reason: 'order_changed_during_payment',
      idempotencyKey: `refund-${id}`,
    });
  });

  it('iade komutu da yazilamazsa son care ERROR gunlugu; istemci yine CONFLICT alir', async () => {
    const { id } = await insertDraft(repository, clock);
    cancelDuringCharge(id);
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    const error = vi.fn();
    const logger: Logger = { ...silentLogger, error, child: () => logger };
    const brokenOutbox = { append: () => Promise.reject(new Error('mongo kapali')) };
    // #185 N5: iptal edilmis siparise komut isaretle ayni yazimda gider; son
    // careye dusmek icin o yazim da duser (Mongo'da ikisi ayni transaction).
    const update = repository.update.bind(repository);
    vi.spyOn(repository, 'update').mockImplementation((order, version, events) =>
      order.refund === undefined
        ? update(order, version, events)
        : Promise.reject(new Error('mongo kapali')),
    );
    const withBrokenOutbox = createCreateOrder({
      repository,
      history: repository,
      risk,
      payments,
      stock,
      outbox: brokenOutbox,
      clock,
      lockPolicy: TEST_LOCK_POLICY,
    });

    await expect(
      withBrokenOutbox(
        { orderId: id, userId: 'usr_1', ...byCard(TEST_CARD.APPROVED) },
        scopeWith(logger),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: id }),
      expect.stringContaining('TELAFI BASARISIZ'),
    );
  });
});

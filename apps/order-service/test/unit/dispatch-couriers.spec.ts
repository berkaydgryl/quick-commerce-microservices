/**
 * Kurye atayan iscinin TEK turu ve siparis basina adimi (T13.1 PR 2): bellek
 * deposu, sahte courier, sabit saat. QA T3 (ucustaki atama ile birakma yarisi)
 * burada ve test/integration/courier-dispatch.spec.ts'te gercek Mongo ile.
 */

import { AppError, ERROR_CODES, EVENTS, fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDispatchCouriers } from '../../src/application/dispatch-couriers.js';
import { startCourierDispatching } from '../../src/bootstrap.js';
import {
  COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  COURIER_RETRY_DELAY_MS,
} from '../../src/config/constants.js';
import { withAssignedCourier, withCourierRetry } from '../../src/domain/courier-dispatch.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakeCourierAssignment } from '../support/fake-courier-assignment.js';
import { insertPaid } from '../support/order-builders.js';

const NOW_MS = 1_760_000_600_000;
const paidAt = fixedClock(NOW_MS - 5_000);
const MARKET = 'mkt_migros-jet-moda';
const BATCH = 100;

let repository: InMemoryOrderStore;
let courier: FakeCourierAssignment;
let requestIds: number;

function dispatch(options: { batchSize?: number; logger?: LogLine[] } = {}) {
  return createDispatchCouriers({
    awaiting: repository,
    repository,
    courier,
    clock: fixedClock(NOW_MS),
    batchSize: options.batchSize ?? BATCH,
    retryDelayMs: COURIER_RETRY_DELAY_MS,
    writeAttempts: COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
    newRequestId: () => `req_kurye_${(requestIds += 1)}`,
  })(options.logger === undefined ? silentLogger : recordingLogger(options.logger));
}

const paid = (marketId = MARKET) => insertPaid(repository, paidAt, { marketId });

/** Kuryesiz PREPARING: ilk denemede kurye yoktu, `retryAtMs`'de yeniden. */
async function waiting(retryAtMs: number): Promise<Order> {
  const order = await paid();
  const next = withCourierRetry(order, new Date(retryAtMs), paidAt);
  await repository.update(next, order.version, statusChangedEvents(order, next));
  return next;
}

/** Siparisi baska bir yol (iptal) kapatir: PAID -> CANCELLED (B20c). */
async function cancelElsewhere(orderId: string): Promise<void> {
  const current = await repository.findById(orderId);
  if (current === null) throw new Error('siparis yok');
  const cancelled = transitionOrder(current, ORDER_STATUS.CANCELLED, fixedClock(NOW_MS));
  await repository.update(cancelled, current.version, statusChangedEvents(current, cancelled));
}

async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error('siparis yok');
  return order;
}

const eventsOf = (orderId: string) =>
  repository.recordedEvents.filter((event) => event.orderId === orderId);

beforeEach(() => {
  repository = new InMemoryOrderStore();
  courier = new FakeCourierAssignment();
  requestIds = 0;
});

describe('DispatchCouriers - odenmis siparis', () => {
  it('bos kurye var: kuryeyle PREPARING (tek yazim), olay PAID -> PREPARING, istek market ve adresle', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();

    const round = await dispatch();

    expect(round).toMatchObject({ assigned: 1, noCourier: 0, failed: 0, deferred: 0 });
    expect(await stored(order.id)).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courier: { courierId: 'crr_1', assignedAt: new Date(NOW_MS) },
      version: order.version + 1,
    });
    expect(eventsOf(order.id).at(-1)).toMatchObject({
      topic: EVENTS.ORDER_STATUS_CHANGED,
      version: order.version + 1,
      payload: { from: 'PAID', to: 'PREPARING' },
    });
    expect(courier.assignments).toEqual([
      { orderId: order.id, marketId: MARKET, deliveryLocation: order.deliveryLocation },
    ]);
  });

  it('bos kurye yok: kuryesiz PREPARING, 30 sn sonra yeniden; olay yine PAID -> PREPARING', async () => {
    const order = await paid();

    const round = await dispatch();

    expect(round).toMatchObject({ assigned: 0, noCourier: 1 });
    const after = await stored(order.id);
    expect(after).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courierRetryAt: new Date(NOW_MS + 30_000),
    });
    expect(after).not.toHaveProperty('courier');
    expect(eventsOf(order.id).at(-1)?.payload).toMatchObject({ from: 'PAID', to: 'PREPARING' });
    // Deneme ani gelmeden ikinci tur courier'a gitmez.
    await expect(dispatch()).resolves.toMatchObject({ noCourier: 0, assigned: 0 });
    expect(courier.assignments).toHaveLength(1);
  });
});

describe('DispatchCouriers - kuryesiz PREPARING (30 sn sonra tekrar)', () => {
  it('deneme ani geldi, kurye bosaldi: kurye yazilir, deneme ani silinir; yeni olay YOK', async () => {
    const order = await waiting(NOW_MS);
    const events = eventsOf(order.id).length;
    courier.addIdle(MARKET, 'crr_2');

    await expect(dispatch()).resolves.toMatchObject({ assigned: 1 });

    const after = await stored(order.id);
    expect(after).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courier: { courierId: 'crr_2' },
      version: order.version + 1,
    });
    expect(after).not.toHaveProperty('courierRetryAt');
    expect(after.timeline).toEqual(order.timeline);
    expect(eventsOf(order.id)).toHaveLength(events);
  });

  it('hala bos kurye yok: deneme ani 30 sn ileri alinir, olay YOK', async () => {
    const order = await waiting(NOW_MS - 1);
    const events = eventsOf(order.id).length;

    await expect(dispatch()).resolves.toMatchObject({ noCourier: 1 });

    expect(await stored(order.id)).toMatchObject({
      courierRetryAt: new Date(NOW_MS + 30_000),
      version: order.version + 1,
    });
    expect(eventsOf(order.id)).toHaveLength(events);
  });

  it('deneme ani gelmemis siparis ve kuryeli siparis isciye girmez', async () => {
    await waiting(NOW_MS + 1);
    courier.addIdle(MARKET, 'crr_1', 'crr_2');
    await paid();
    await dispatch();

    await expect(dispatch()).resolves.toMatchObject({ assigned: 0, noCourier: 0 });
    expect(courier.assignments).toHaveLength(1);
  });
});

describe('DispatchCouriers - courier-svc hatalari', () => {
  it('ulasilamiyor (SERVICE_UNAVAILABLE): siparis DEGISMEZ, tur kesilir, kalanlar sonraki turda', async () => {
    const first = await paid();
    const second = await paid();
    courier.assignFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'courier kapali');

    const round = await dispatch();

    expect(round).toMatchObject({ deferred: 2, failed: 0, assigned: 0 });
    expect(courier.assignments).toHaveLength(1);
    expect((await stored(first.id)).status).toBe(ORDER_STATUS.PAID);
    expect((await stored(second.id)).version).toBe(second.version);

    courier.assignFailure = undefined;
    courier.addIdle(MARKET, 'crr_1', 'crr_2');
    await expect(dispatch()).resolves.toMatchObject({ assigned: 2, deferred: 0 });
  });

  it('baska hata (orn. eszamanli atamanin kazanani birakildi, CONFLICT): sayilir, siradaki yine atanir', async () => {
    const orders = [await paid(), await paid()];
    courier.addIdle(MARKET, 'crr_1');
    const assign = vi.spyOn(courier, 'assign');
    assign.mockRejectedValueOnce(new AppError(ERROR_CODES.CONFLICT, 'kazanan birakildi'));

    const round = await dispatch();

    // Hangi siparisin once islendigi kimlik sirasina bagli (kimlikler rastgele):
    // ilk istegi alan dusen siparistir, oteki kuryeyi alir.
    const failedId = assign.mock.calls[0]?.[0].orderId;
    const otherId = orders.map((order) => order.id).find((id) => id !== failedId) ?? '';
    expect(round).toMatchObject({ failed: 1, assigned: 1 });
    expect((await stored(failedId ?? '')).status).toBe(ORDER_STATUS.PAID);
    expect((await stored(otherId)).courier?.courierId).toBe('crr_1');
  });

  it('her siparis kendi istek kimligiyle: courier ayni kimligi gorur', async () => {
    courier.addIdle(MARKET, 'crr_1', 'crr_2');
    await paid();
    await paid();

    await dispatch();

    expect(courier.requestIds).toEqual(['req_kurye_1', 'req_kurye_2']);
  });

  it('turda en fazla batchSize siparis; once odenmisler, sonra deneme ani en eski', async () => {
    const lateRetry = await waiting(NOW_MS - 1_000);
    const earlyRetry = await waiting(NOW_MS - 5_000);
    const fresh = await paid();
    courier.addIdle(MARKET, 'crr_1', 'crr_2', 'crr_3');

    await expect(dispatch({ batchSize: 2 })).resolves.toMatchObject({ assigned: 2 });

    expect(courier.assignments.map((request) => request.orderId)).toEqual([
      fresh.id,
      earlyRetry.id,
    ]);
    expect(await stored(lateRetry.id)).not.toHaveProperty('courier');
  });
});

describe('DispatchCouriers - yazim yarisi ve telafi (QA T3)', () => {
  it('T3: birakma ucustaki atamadan ONCE gelir (released=false), siparis iptal; order yazamaz ve kuryeyi GERI VERIR', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();
    // Atama courier'a yolda: siparis bu arada iptal edilir ve iptal yolu
    // kuryeyi birakmak ister, ama kurye henuz baglanmadi.
    courier.beforeAssignApplies = async (orderId) => {
      await cancelElsewhere(orderId);
      await courier.release(orderId, { requestId: 'req_iptal', logger: silentLogger });
    };
    const lines: LogLine[] = [];

    const round = await dispatch({ logger: lines });

    expect(round).toMatchObject({ released: 1, assigned: 0, failed: 0 });
    expect(courier.releases).toEqual([
      { orderId: order.id, released: false },
      { orderId: order.id, released: true },
    ]);
    expect(courier.carrying.has(order.id)).toBe(false);
    expect(courier.idleIn(MARKET)).toEqual(['crr_1']);
    const after = await stored(order.id);
    expect(after.status).toBe(ORDER_STATUS.CANCELLED);
    expect(after).not.toHaveProperty('courier');
    const warning = lines.find(
      (line) => line.message === 'siparis kurye atanirken kapandi; kurye geri verildi',
    );
    expect(warning).toMatchObject({
      level: 'warn',
      fields: { orderId: order.id, courierId: 'crr_1', status: 'CANCELLED', released: true },
    });
  });

  it('siparis o arada silindi (kayit yok): kurye geri verilir', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();
    vi.spyOn(repository, 'update').mockRejectedValueOnce(
      new AppError(ERROR_CODES.CONFLICT, 'surum cakismasi'),
    );
    vi.spyOn(repository, 'findById').mockResolvedValueOnce(null);

    await expect(dispatch()).resolves.toMatchObject({ released: 1 });
    expect(courier.releases).toEqual([{ orderId: order.id, released: true }]);
  });

  it('baska ornek ayni kuryeyi once yazdi: dokunulmaz, kurye BIRAKILMAZ', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();
    courier.beforeAssignReturns = async (orderId, courierId) => {
      const current = await stored(orderId);
      const other = withAssignedCourier(current, courierId, fixedClock(NOW_MS));
      await repository.update(other, current.version, statusChangedEvents(current, other));
    };

    await expect(dispatch()).resolves.toMatchObject({ skipped: 1, released: 0 });
    expect(courier.releases).toEqual([]);
    expect(courier.carrying.get(order.id)).toBe('crr_1');
    expect((await stored(order.id)).courier?.courierId).toBe('crr_1');
  });

  it('baska ornek "kurye yok" yazdi (siparis hala kurye bekliyor): atama guncel kayda yeniden yazilir', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();
    courier.beforeAssignReturns = async (orderId) => {
      const current = await stored(orderId);
      const other = withCourierRetry(current, new Date(NOW_MS + 30_000), fixedClock(NOW_MS));
      await repository.update(other, current.version, statusChangedEvents(current, other));
    };

    await expect(dispatch()).resolves.toMatchObject({ assigned: 1 });
    const after = await stored(order.id);
    expect(after).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courier: { courierId: 'crr_1' },
    });
    expect(after).not.toHaveProperty('courierRetryAt');
    // PAID -> PREPARING bir kez: ikinci yazim gecis degil.
    expect(
      eventsOf(order.id).filter((event) => event.payload['to'] === ORDER_STATUS.PREPARING),
    ).toHaveLength(1);
  });

  it('yazim her seferinde cakisirsa en fazla COURIER_ASSIGNMENT_WRITE_ATTEMPTS deneme; kurye birakilmaz', async () => {
    courier.addIdle(MARKET, 'crr_1');
    await paid();
    const update = vi
      .spyOn(repository, 'update')
      .mockRejectedValue(new AppError(ERROR_CODES.CONFLICT, 'surum cakismasi'));

    await expect(dispatch()).resolves.toMatchObject({ skipped: 1, released: 0 });
    expect(update).toHaveBeenCalledTimes(COURIER_ASSIGNMENT_WRITE_ATTEMPTS);
    expect(courier.releases).toEqual([]);
  });

  it('cakisma disi yazim hatasi: kurye birakilmaz (yazim olmus olabilir); sonraki tur AYNI kuryeyi yazar', async () => {
    courier.addIdle(MARKET, 'crr_1', 'crr_2');
    const order = await paid();
    vi.spyOn(repository, 'update').mockRejectedValueOnce(AppError.internal('mongo hatasi'));

    await expect(dispatch()).resolves.toMatchObject({ failed: 1 });
    expect(courier.releases).toEqual([]);

    await expect(dispatch()).resolves.toMatchObject({ assigned: 1 });
    expect((await stored(order.id)).courier?.courierId).toBe('crr_1');
    expect(courier.idleIn(MARKET)).toEqual(['crr_2']);
  });

  it('telafi birakmasi da duserse hata sayilir (sonraki tur iptal edilmis siparisi gormez)', async () => {
    courier.addIdle(MARKET, 'crr_1');
    await paid();
    courier.beforeAssignApplies = async (orderId) => cancelElsewhere(orderId);
    courier.releaseFailure = AppError.internal('courier hatasi');

    await expect(dispatch()).resolves.toMatchObject({ failed: 1, released: 0 });
  });
});

describe('startCourierDispatching (kurulum)', () => {
  it('bellek deposunda da calisir: aralik dolunca odenen siparis kuryeyle PREPARING, kapanista durur', async () => {
    vi.useFakeTimers();
    try {
      courier.addIdle(MARKET, 'crr_1');
      const order = await paid();
      const dispatcher = startCourierDispatching({
        awaiting: repository,
        repository,
        courier,
        logger: silentLogger,
        clock: fixedClock(NOW_MS),
        intervalMs: 1_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await dispatcher.stop();

      expect(await stored(order.id)).toMatchObject({
        status: ORDER_STATUS.PREPARING,
        courier: { courierId: 'crr_1' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

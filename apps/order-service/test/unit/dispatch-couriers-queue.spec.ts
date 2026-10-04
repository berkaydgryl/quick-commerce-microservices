/**
 * Kurye kuyrugunun sirasi (#92, T13.2) ve bekleyenin gunluk gurultusu (D2):
 * bellek deposu, sahte courier, ilerleyen saat.
 *
 * Kural: turda kurye istenecek bir siparis varsa (yeni odeme ya da deneme ani
 * gelmis bekleyen), ondan ONCE odemis kuryesiz bekleyenler de ayni turda ve
 * once denenir. Bekleyen siparis, ondan sonra odeyen siparise kuryeyi
 * kaptirmaz (QA'nin W/N senaryosu). Talep yoksa bekleyenler 30 sn kuralini
 * surdurur.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDispatchCouriers } from '../../src/application/dispatch-couriers.js';
import {
  COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  COURIER_RETRY_DELAY_MS,
} from '../../src/config/constants.js';
import { withCourierRetry } from '../../src/domain/courier-dispatch.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import type { Order } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakeCourierAssignment } from '../support/fake-courier-assignment.js';
import { insertPaid } from '../support/order-builders.js';

const T0 = 1_760_000_000_000;
const SECOND = 1_000;
const MARKET = 'mkt_migros-jet-moda';
const OTHER_MARKET = 'mkt_migros-jet-besiktas';
const NO_COURIER_INFO =
  'markette bos kurye yok; siparis kuryesiz bekliyor, sonra yeniden denenecek';

let clock: MutableClock;
let repository: InMemoryOrderStore;
let courier: FakeCourierAssignment;
let lines: LogLine[];

beforeEach(() => {
  clock = fixedClock(T0);
  repository = new InMemoryOrderStore();
  courier = new FakeCourierAssignment();
  lines = [];
});

function dispatch(batchSize = 100) {
  return createDispatchCouriers({
    awaiting: repository,
    repository,
    courier,
    clock,
    batchSize,
    retryDelayMs: COURIER_RETRY_DELAY_MS,
    writeAttempts: COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  })(recordingLogger(lines));
}

/** `atMs`'de odenmis siparis (odeme adimi gibi kuyruga odeme aniyla girer). */
const paidAt = (atMs: number, marketId = MARKET) =>
  insertPaid(repository, fixedClock(atMs), { marketId });

/** `paidMs`'de odemis, kurye bulamamis, `retryAtMs`'de yeniden denenecek siparis. */
async function waitingSince(paidMs: number, retryAtMs: number): Promise<Order> {
  const order = await paidAt(paidMs);
  const next = withCourierRetry(order, new Date(retryAtMs), fixedClock(paidMs));
  await repository.update(next, order.version, statusChangedEvents(order, next));
  return next;
}

async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error('siparis yok');
  return order;
}

const askedFor = () => courier.assignments.map((request) => request.orderId);

describe('kurye kuyrugu (#92): once odeyen once', () => {
  it('QA W/N: W bekliyor, kurye t+10 da bosalir, N t+11 de oder -> kurye W ye gider, N bekler', async () => {
    const w = await paidAt(T0);
    await dispatch(); // kurye yok: W kuryesiz PREPARING, T0+30 sn'de yeniden
    clock.advance(10 * SECOND);
    courier.addIdle(MARKET, 'crr_1');
    clock.advance(SECOND);
    const n = await paidAt(clock.now());

    const round = await dispatch();

    expect(round).toMatchObject({ assigned: 1, noCourier: 1 });
    expect(askedFor()).toEqual([w.id, w.id, n.id]);
    expect((await stored(w.id)).courier?.courierId).toBe('crr_1');
    expect(await stored(n.id)).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courierRetryAt: new Date(clock.now() + COURIER_RETRY_DELAY_MS),
      courierQueuedAt: n.courierQueuedAt,
    });
  });

  it('talep yokken bekleyene dokunulmaz (30 sn kurali); deneme ani gelince bosalan kuryeyi alir', async () => {
    const w = await paidAt(T0);
    await dispatch();
    courier.addIdle(MARKET, 'crr_1');
    clock.advance(10 * SECOND);

    await expect(dispatch()).resolves.toMatchObject({ assigned: 0, noCourier: 0 });
    expect(askedFor()).toEqual([w.id]);

    clock.advance(20 * SECOND);
    await expect(dispatch()).resolves.toMatchObject({ assigned: 1 });
    expect((await stored(w.id)).courier?.courierId).toBe('crr_1');
  });

  it('turun sirasi odeme ani: talep sinirini asan yeni odemenin onundeki bekleyenler de denenir', async () => {
    const w1 = await waitingSince(T0, T0 + 60 * SECOND); // deneme ani gelmedi
    const w2 = await waitingSince(T0 + SECOND, T0 + 10 * SECOND); // deneme ani geldi
    const p1 = await paidAt(T0 + 20 * SECOND);
    const p2 = await paidAt(T0 + 21 * SECOND);
    courier.addIdle(MARKET, 'crr_1', 'crr_2', 'crr_3');
    clock.advance(25 * SECOND);

    // Talep 2 ile sinirli (p1, p2); onlardan once odeyen iki bekleyen de turda.
    const round = await dispatch(2);

    expect(askedFor()).toEqual([w1.id, w2.id, p1.id, p2.id]);
    expect(round).toMatchObject({ assigned: 3, noCourier: 1 });
    expect((await stored(w1.id)).courier?.courierId).toBe('crr_1');
    expect((await stored(w2.id)).courier?.courierId).toBe('crr_2');
    expect((await stored(p1.id)).courier?.courierId).toBe('crr_3');
    expect(await stored(p2.id)).not.toHaveProperty('courier');
  });

  it('baska semtteki eski bekleyen yeniyi engellemez: o kurye bulamaz, yeni siparis kendi kuryesini alir', async () => {
    const far = await paidAt(T0, OTHER_MARKET);
    await dispatch();
    const farWaiting = await stored(far.id);
    courier.addIdle(MARKET, 'crr_1');
    clock.advance(5 * SECOND);
    const near = await paidAt(clock.now());

    await expect(dispatch()).resolves.toMatchObject({ assigned: 1, noCourier: 1 });

    expect(askedFor()).toEqual([far.id, far.id, near.id]);
    expect((await stored(near.id)).courier?.courierId).toBe('crr_1');
    // Bekleyen yine kurye bulamadi: yazilmadi (O2), deneme ani ilk beklemeninki.
    expect(await stored(far.id)).toMatchObject({
      courierRetryAt: new Date(T0 + COURIER_RETRY_DELAY_MS),
      version: farWaiting.version,
    });
  });

  it('kuyruk ani bekleyende kalir, kurye ataninca silinir', async () => {
    const order = await paidAt(T0);
    await dispatch();
    expect((await stored(order.id)).courierQueuedAt).toEqual(new Date(T0));

    courier.addIdle(MARKET, 'crr_1');
    clock.advance(30 * SECOND);
    await dispatch();

    const assigned = await stored(order.id);
    expect(assigned.courier?.courierId).toBe('crr_1');
    expect(assigned).not.toHaveProperty('courierQueuedAt');
    expect(assigned).not.toHaveProperty('courierRetryAt');
  });
});

describe('D2: bekleyenin yeniden denemesi gunlugu doldurmaz', () => {
  it('INFO yalnizca PAID -> kuryesiz PREPARING geciste; yine kurye yoksa INFO yok (DEBUG)', async () => {
    const order = await paidAt(T0);
    await dispatch();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      clock.advance(30 * SECOND);
      await expect(dispatch()).resolves.toMatchObject({ noCourier: 1 });
    }

    const infos = lines.filter((line) => line.level === 'info' && line.message === NO_COURIER_INFO);
    expect(infos).toHaveLength(1);
    expect(infos[0]?.fields).toMatchObject({ orderId: order.id });
    expect(
      lines.filter(
        (line) => line.level === 'debug' && line.message === 'bekleyen siparise yine bos kurye yok',
      ),
    ).toHaveLength(3);
  });
});

describe('QA O2: kurye yokken bekleyenler her talepte yeniden yazilmaz ve sorulmaz', () => {
  it('K bekleyen + surekli talep, kurye yok: turda courier cagrisi <= bekleyen market sayisi, bekleyen yazimi 0', async () => {
    const waiters: Order[] = [];
    for (let index = 0; index < 30; index += 1) {
      waiters.push(await waitingSince(T0 + index, T0 + 10 * 60 * SECOND));
    }
    for (let index = 0; index < 20; index += 1) {
      const order = await paidAt(T0 + 100 + index, OTHER_MARKET);
      const next = withCourierRetry(order, new Date(T0 + 10 * 60 * SECOND), fixedClock(T0));
      await repository.update(next, order.version, statusChangedEvents(order, next));
      waiters.push(next);
    }
    const waiterIds = new Set(waiters.map((order) => order.id));
    const writes = vi.spyOn(repository, 'update');

    const callsPerRound: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      clock.advance(SECOND);
      await paidAt(clock.now(), round % 2 === 0 ? MARKET : OTHER_MARKET); // surekli talep
      const before = courier.assignments.length;
      await expect(dispatch()).resolves.toMatchObject({ assigned: 0, noCourier: 51 + round });
      callsPerRound.push(courier.assignments.length - before);
    }

    // Iki market bekliyor: turda en cok iki cagri (her marketin en eski bekleyeni).
    expect(callsPerRound).toEqual([2, 2, 2]);
    expect(courier.assignments.map((request) => request.orderId).slice(0, 2)).toEqual([
      waiters[0]?.id,
      waiters[30]?.id,
    ]);
    expect(writes.mock.calls.filter(([order]) => waiterIds.has(order.id))).toEqual([]);
    for (const waiter of waiters) {
      expect((await stored(waiter.id)).version).toBe(waiter.version);
    }
  });

  it('ayni turda market "kurye yok" dedikten sonra o marketin yeni odemesi sorulmadan kuryesiz PREPARING olur (INFO bir kez); baska market yine sorulur', async () => {
    const waiter = await waitingSince(T0, T0 + 10 * 60 * SECOND);
    clock.advance(SECOND);
    const fresh = await paidAt(clock.now());
    const elsewhere = await paidAt(clock.now() + 1, OTHER_MARKET);
    courier.addIdle(OTHER_MARKET, 'crr_9');

    await expect(dispatch()).resolves.toMatchObject({ assigned: 1, noCourier: 2 });

    expect(askedFor()).toEqual([waiter.id, elsewhere.id]);
    expect(await stored(fresh.id)).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courierRetryAt: new Date(clock.now() + COURIER_RETRY_DELAY_MS),
    });
    expect((await stored(elsewhere.id)).courier?.courierId).toBe('crr_9');
    expect(
      lines
        .filter((line) => line.message === NO_COURIER_INFO)
        .map((line) => line.fields['orderId']),
    ).toEqual([fresh.id]);
  });
});

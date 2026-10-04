/**
 * Kurye turunun hatalari (T13.2): kaynak ayrimi (D1) ve siparis basina geri
 * cekilme (D3). Bellek deposu, sahte courier, ilerleyen saat; ayni tur
 * nesnesi turlar boyunca kullanilir (geri cekilme durumu onun icinde).
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDispatchCouriers } from '../../src/application/dispatch-couriers.js';
import type { DispatchCouriers } from '../../src/application/dispatch-couriers.js';
import {
  COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  COURIER_RETRY_DELAY_MS,
} from '../../src/config/constants.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakeCourierAssignment } from '../support/fake-courier-assignment.js';
import { insertPaid } from '../support/order-builders.js';

const T0 = 1_760_000_000_000;
const SECOND = 1_000;
const MARKET = 'mkt_migros-jet-moda';
/** Courier'in reddettigi siparisin marketi: "kurye yok" diyen marketten ayri (O2 atlamasi karismasin). */
const REJECTED_MARKET = 'mkt_reddedilen';
const FIRST_FAILURE = 'siparise kurye atanamadi; geri cekilerek yeniden denenecek';

let clock: MutableClock;
let repository: InMemoryOrderStore;
let courier: FakeCourierAssignment;
let lines: LogLine[];
let tour: DispatchCouriers;

const unavailable = (what: string) => new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, what);
const rejected = () => new AppError(ERROR_CODES.VALIDATION_FAILED, 'gecersiz istek');

beforeEach(() => {
  clock = fixedClock(T0);
  repository = new InMemoryOrderStore();
  courier = new FakeCourierAssignment();
  lines = [];
  tour = createDispatchCouriers({
    awaiting: repository,
    repository,
    courier,
    clock,
    batchSize: 100,
    retryDelayMs: COURIER_RETRY_DELAY_MS,
    writeAttempts: COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
    backoff: { initialMs: SECOND, maxMs: 4 * SECOND },
  });
});

const dispatch = () => tour(recordingLogger(lines));
const paid = (marketId = MARKET) => insertPaid(repository, clock, { marketId });
const warnings = () => lines.filter((line) => line.level === 'warn').map((line) => line.message);

describe('D1: hatanin kaynagi', () => {
  it('courier ulasilamiyor: tur kesilir, kaynak courier; siparisler degismez', async () => {
    const orders = [await paid(), await paid()];
    courier.assignFailure = unavailable('courier kapali');

    const round = await dispatch();

    expect(round).toMatchObject({ unavailable: 'courier', deferred: 2, failed: 0 });
    expect(round.cause).toBe(courier.assignFailure);
    for (const order of orders) {
      expect((await repository.findById(order.id))?.status).toBe(ORDER_STATUS.PAID);
    }
  });

  it('depo yazamiyor (SERVICE_UNAVAILABLE): tur kesilir, kaynak DEPO (courier degil); kurye birakilmaz', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();
    vi.spyOn(repository, 'update').mockRejectedValueOnce(unavailable('Veritabanina ulasilamiyor'));

    const round = await dispatch();

    expect(round).toMatchObject({ unavailable: 'store', deferred: 1, failed: 0 });
    expect(courier.releases).toEqual([]);
    // Depo geri gelince ayni kurye yazilir (courier tekrar guvenli).
    await expect(dispatch()).resolves.toMatchObject({ assigned: 1 });
    expect((await repository.findById(order.id))?.courier?.courierId).toBe('crr_1');
  });

  it('kuyruk okunamazsa tur hata FIRLATMAZ: kaynak depo, hata cause da; courier e gidilmez', async () => {
    await paid();
    const failure = unavailable('Veritabanina ulasilamiyor');
    vi.spyOn(repository, 'findAwaitingCourier').mockRejectedValueOnce(failure);

    const round = await dispatch();

    expect(round).toMatchObject({ unavailable: 'store', deferred: 0, assigned: 0 });
    expect(round.cause).toBe(failure);
    expect(courier.assignments).toEqual([]);
  });

  it('ulasilamama disi hata kaynagiyla sayilir: courier reddi courier, depo hatasi depo', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const [first, second] = [await paid(), await paid()];
    vi.spyOn(courier, 'assign').mockImplementation((request) =>
      request.orderId === first.id
        ? Promise.reject(rejected())
        : Promise.resolve({ courierId: 'crr_1' }),
    );
    vi.spyOn(repository, 'update').mockImplementation((order) =>
      order.id === second.id ? Promise.reject(new Error('disk dolu')) : Promise.resolve(),
    );

    const round = await dispatch();

    expect(round).toMatchObject({
      failed: 2,
      failedBy: { courier: 1, store: 1, order: 0 },
    });
    expect(round).not.toHaveProperty('unavailable');
  });
});

describe('D3: siparis basina geri cekilme', () => {
  it('reddedilen siparis her turda denenmez: 1 sn, 2 sn, 4 sn (ust sinir); WARN bir kez; digerleri engellenmez', async () => {
    const stuck = await paid(REJECTED_MARKET);
    const assign = vi.spyOn(courier, 'assign');
    assign.mockImplementation((request) =>
      request.orderId === stuck.id ? Promise.reject(rejected()) : Promise.resolve(null),
    );
    const attemptsAt: number[] = [];
    for (let second = 0; second <= 12; second += 1) {
      const before = assign.mock.calls.length;
      await dispatch();
      if (assign.mock.calls.slice(before).some(([request]) => request.orderId === stuck.id)) {
        attemptsAt.push(second);
      }
      if (second === 0) {
        await paid(); // ikinci siparis geri cekilmeden etkilenmez
      }
      clock.advance(SECOND);
    }

    // 0 -> +1 sn -> +2 sn -> +4 sn -> +4 sn (ust sinir 4 sn).
    expect(attemptsAt).toEqual([0, 1, 3, 7, 11]);
    expect(warnings()).toEqual([FIRST_FAILURE]);
    expect(lines.find((line) => line.message === FIRST_FAILURE)?.fields).toMatchObject({
      orderId: stuck.id,
      source: 'courier',
      failures: 1,
      retryAt: new Date(T0 + SECOND),
    });
    expect(
      lines.filter(
        (line) => line.level === 'debug' && line.message === 'siparise kurye yine atanamadi',
      ),
    ).toHaveLength(4);
  });

  it('geri cekilmedeki siparis turda sayilir (backedOff); duzelince atanir ve kaydi silinir', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();
    const assign = vi.spyOn(courier, 'assign');
    assign.mockRejectedValueOnce(rejected());

    await expect(dispatch()).resolves.toMatchObject({ failed: 1 });
    await expect(dispatch()).resolves.toMatchObject({ backedOff: 1, failed: 0 });
    clock.advance(SECOND);
    await expect(dispatch()).resolves.toMatchObject({ assigned: 1, backedOff: 0 });
    expect((await repository.findById(order.id))?.courier?.courierId).toBe('crr_1');

    // Kayit silindi: ayni siparisin yeni bir hatasi yine ILK hata sayilir.
    assign.mockRejectedValueOnce(rejected());
    const next = await paid();
    await dispatch();
    expect(warnings()).toEqual([FIRST_FAILURE, FIRST_FAILURE]);
    expect(lines.at(-1)?.fields).toMatchObject({ orderId: next.id, failures: 1 });
  });

  it('geri cekilmedeki siparis TALEP sayilmaz: ondan once odemis bekleyen onun yuzunden her turda denenmez', async () => {
    const waiter = await paid();
    await dispatch(); // kurye yok: bekleyen, 30 sn sonra yeniden
    clock.advance(SECOND);
    const stuck = await paid(REJECTED_MARKET);
    const assign = vi.spyOn(courier, 'assign');
    assign.mockImplementation((request) =>
      request.orderId === stuck.id ? Promise.reject(rejected()) : Promise.resolve(null),
    );
    const askedWaiter = () =>
      assign.mock.calls.filter(([request]) => request.orderId === waiter.id).length;

    await dispatch(); // stuck talep: bekleyen once denenir, stuck geri cekilir (1 sn)
    expect(askedWaiter()).toBe(1);

    await expect(dispatch()).resolves.toMatchObject({ backedOff: 1, noCourier: 0 });
    expect(askedWaiter()).toBe(1);

    clock.advance(SECOND); // stuck yeniden talep: bekleyen bir kez daha
    await dispatch();
    expect(askedWaiter()).toBe(2);
  });

  it('ulasilamama geri cekilme baslatmaz: courier donunce siparis hemen denenir', async () => {
    courier.addIdle(MARKET, 'crr_1');
    const order = await paid();
    courier.assignFailure = unavailable('courier kapali');
    await dispatch();
    courier.assignFailure = undefined;

    await expect(dispatch()).resolves.toMatchObject({ assigned: 1, backedOff: 0 });
    expect((await repository.findById(order.id))?.courier?.courierId).toBe('crr_1');
    expect(warnings()).toEqual([]);
  });
});

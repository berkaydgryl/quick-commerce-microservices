/**
 * QA kara kutu (T13.2 PR 2, D3): atanamayan siparisin geri cekilmesi, GERCEK
 * courier-svc'ye gercek gRPC ile (uretim istemcisi), iki taraf bellekte. Saat elle
 * ilerler; isci her saniye bir tur atar gibi kosulur.
 *
 *   1. Kalici hata (courier INVALID_ARGUMENT): courier'e giden denemeler 1, 2, 4 ...
 *      saniye arayla, en cok 5 dk; order gunlugunde siparis basina TEK WARN.
 *   2. Gecici hata duzelince siparis KENDI deneme aninda atanir (once degil).
 *   3. Isci yeniden baslarsa (yeni ornek) geri cekilme sifirlanir: siparis hemen denenir.
 *
 * Backend testleri sahte courier'le ayni kurallari sinar; burada courier'in kendi
 * dogrulamasi ve hata cevabi tel uzerinden gelir.
 */

import { fixedClock, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { MARKET_LOCATION_SEEDS } from '../../../courier-service/src/infrastructure/fixtures/couriers.js';
import { InMemoryCourierStore } from '../../../courier-service/src/infrastructure/memory/in-memory-courier-store.js';
import {
  COURIER_FAILURE_BACKOFF_INITIAL_MS,
  COURIER_FAILURE_BACKOFF_MAX_MS,
} from '../../src/config/constants.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import {
  HookedCourierRepository,
  orderSide,
  placeCouriers,
  QA_NOW_MS,
  startCourierService,
} from '../support/qa-courier-world.js';
import type { QaCourierService, QaOrderSide } from '../support/qa-courier-world.js';

const TOUR_MS = 1_000;
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

interface World {
  readonly courier: QaCourierService;
  readonly hooks: HookedCourierRepository;
  readonly courierLines: LogLine[];
  readonly orderLines: LogLine[];
  readonly clock: ReturnType<typeof fixedClock>;
  readonly store: Awaited<ReturnType<typeof openOrderStore>>;
  side(): QaOrderSide;
}

async function world(): Promise<World> {
  const clock = fixedClock(QA_NOW_MS);
  const courierLines: LogLine[] = [];
  const orderLines: LogLine[] = [];
  const hooks = new HookedCourierRepository(
    new InMemoryCourierStore(placeCouriers(3), MARKET_LOCATION_SEEDS),
  );
  const courier = await startCourierService({
    repository: hooks,
    clock,
    logger: recordingLogger(courierLines),
  });
  cleanups.push(() => courier.stop());
  const store = await openOrderStore(undefined, silentLogger, 'test');
  return {
    courier,
    hooks,
    courierLines,
    orderLines,
    clock,
    store,
    // Her cagri YENI bir isci ornegi (geri cekilme durumu ornek basina, bellekte).
    side: () => {
      const side = orderSide({
        store,
        courierAddress: courier.address,
        clock,
        logger: recordingLogger(orderLines),
      });
      cleanups.push(() => side.close());
      return side;
    },
  };
}

/** courier'in tel uzerinden reddettigi AssignCourier istekleri (dogrulama hatasi). */
function rejectedAssigns(lines: readonly LogLine[]): number {
  return new Set(
    lines
      .filter(
        (line) => line.fields.rpc === 'AssignCourier' && line.fields.code === 'VALIDATION_FAILED',
      )
      .map((line) => line.fields.requestId),
  ).size;
}

/** Beklenen deneme anlari (sn): her hatada bekleme ikiye katlanir, ust sinir 5 dk. */
function expectedTryTimes(untilSeconds: number): number[] {
  const times: number[] = [];
  let at = 0;
  let failures = 0;
  while (at <= untilSeconds) {
    times.push(at);
    failures += 1;
    const delayMs = Math.min(
      COURIER_FAILURE_BACKOFF_INITIAL_MS * 2 ** (failures - 1),
      COURIER_FAILURE_BACKOFF_MAX_MS,
    );
    at += delayMs / 1_000;
  }
  return times;
}

describe('QA T13.2 D3: siparis basina geri cekilme, gercek courier', () => {
  it('kalici hata (courier dogrulamasi reddeder): denemeler 1, 2, 4 ... sn arayla, en cok 5 dk; siparis basina tek WARN', async () => {
    const w = await world();
    const side = w.side();
    // Sozlesme disi eski kayit gibi: market kimligi bicimsiz, courier her seferinde reddeder.
    const broken = await side.paidAs(`ord_${'0'.repeat(32)}`, { marketId: 'mkt_' });
    const horizonSeconds = 1_200;

    const tries: number[] = [];
    for (let second = 0; second <= horizonSeconds; second += 1) {
      const before = rejectedAssigns(w.courierLines);
      await side.tour();
      if (rejectedAssigns(w.courierLines) > before) tries.push(second);
      w.clock.advance(TOUR_MS);
    }
    const gaps = tries.slice(1).map((at, index) => at - (tries[index] ?? 0));
    const warns = w.orderLines.filter(
      (line) => line.level === 'warn' && line.fields.orderId === broken.id,
    );

    expect(tries).toEqual(expectedTryTimes(horizonSeconds));
    expect(Math.max(...gaps)).toBe(COURIER_FAILURE_BACKOFF_MAX_MS / 1_000);
    expect(warns).toHaveLength(1);
  });

  it('gecici hata duzelince siparis KENDI deneme aninda atanir (once degil); diger siparis beklemez', async () => {
    const w = await world();
    const side = w.side();
    const flaky = await side.paid();
    let failing = true;
    const attempts: number[] = [];
    let second = 0;
    w.hooks.beforeClaim = (request) => {
      if (request.orderId !== flaky.id) return Promise.resolve();
      attempts.push(second);
      return failing
        ? Promise.reject(new Error('courier deposunda beklenmeyen hata'))
        : Promise.resolve();
    };

    let assignedAt: number | undefined;
    let other: string | undefined;
    for (; second <= 20; second += 1) {
      if (second === 4) failing = false;
      if (second === 2) other = (await side.paid()).id;
      await side.tour();
      if (assignedAt === undefined && (await side.order(flaky.id))?.courier !== undefined)
        assignedAt = second;
      w.clock.advance(TOUR_MS);
    }
    const otherOrder = await side.order(other ?? '');

    // 0, 1, 3 hata; duzelme 4'te; siradaki deneme 3 + 4 = 7.
    expect(attempts).toEqual([0, 1, 3, 7]);
    expect(assignedAt).toBe(7);
    expect(otherOrder?.courier).toBeDefined();
  });

  it('isci yeniden baslarsa geri cekilme sifirlanir: siparis hemen denenir, WARN yine bir kez', async () => {
    const w = await world();
    const first = w.side();
    const broken = await first.paidAs(`ord_${'1'.repeat(32)}`, { marketId: 'mkt_' });
    for (let second = 0; second < 10; second += 1) {
      await first.tour();
      w.clock.advance(TOUR_MS);
    }
    const before = rejectedAssigns(w.courierLines);

    const restarted = w.side();
    await restarted.tour();
    const warns = w.orderLines.filter(
      (line) => line.level === 'warn' && line.fields.orderId === broken.id,
    );

    expect(rejectedAssigns(w.courierLines)).toBe(before + 1);
    // Her ornek kendi WARN'ini yazar: ilk ornek bir, yeniden baslayan bir.
    expect(warns).toHaveLength(2);
  });
});

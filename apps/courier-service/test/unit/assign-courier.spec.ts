/**
 * Atama use-case'i (T13.1; havuz T13.2): atomik secim depoda (sozlesme testi),
 * burada market konumu, tekrar ve eszamanlilik kurallari, NOT_FOUND ve gunluk.
 */

import { AppError, ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createAssignCourier, MARKET_UNKNOWN } from '../../src/application/assign-courier.js';
import { createNearestAvailableStrategy } from '../../src/application/nearest-available.js';
import { ETA_NOT_COMPUTED_SECONDS } from '../../src/config/constants.js';
import type { AssignmentStrategy } from '../../src/domain/assignment-strategy.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import {
  courier,
  courierId,
  DELIVERY,
  FAR_MARKET,
  MARKET,
  NOW_MS,
  orderId,
  POOL_RULE,
  TEST_MARKETS,
} from '../support/couriers.js';

function setup(couriers: readonly Courier[], strategy?: AssignmentStrategy) {
  const repository = new InMemoryCourierStore(couriers, TEST_MARKETS);
  const lines: LogLine[] = [];
  const assign = createAssignCourier({
    repository,
    markets: repository,
    strategy: strategy ?? createNearestAvailableStrategy(repository, POOL_RULE),
    clock: fixedClock(NOW_MS),
  });
  const run = (order: string, marketId = MARKET) =>
    assign({ orderId: order, marketId, deliveryLocation: DELIVERY }, recordingLogger(lines));
  return { repository, lines, run };
}

/** Siparise baska istek kurye baglamis gibi davranan secim: benzersiz indeks CONFLICT'i. */
function losingStrategy(onClaim: () => void): AssignmentStrategy {
  return {
    name: 'kaybeden',
    claim: () => {
      onClaim();
      return Promise.reject(AppError.conflict('Kayit zaten var'));
    },
  };
}

describe('createAssignCourier', () => {
  it('bos kuryeyi atar: BUSY, siparise bagli, atama ani saatten; ETA henuz hesaplanmaz', async () => {
    const { run, lines } = setup([courier(1)]);
    const order = orderId();

    const assignment = await run(order);

    expect(assignment).toEqual({
      courier: {
        ...courier(1),
        status: COURIER_STATUS.BUSY,
        currentOrderId: order,
        lastAssignedAt: new Date(NOW_MS),
      },
      etaSeconds: ETA_NOT_COMPUTED_SECONDS,
      reused: false,
    });
    expect(lines).toEqual([
      {
        level: 'info',
        message: 'kurye atandi',
        fields: {
          orderId: order,
          courierId: courierId(1),
          marketId: MARKET,
          strategy: 'nearest-available',
        },
      },
    ]);
  });

  it('ayni siparis tekrar istenirse AYNI kurye doner, ikinci kurye baglanmaz', async () => {
    const { run, repository } = setup([courier(1), courier(2)]);
    const order = orderId();

    const first = await run(order);
    const second = await run(order);

    expect(second).toEqual({ ...first, reused: true });
    expect((await repository.findById(courierId(2)))?.status).toBe(COURIER_STATUS.IDLE);
  });

  it('tekrar istek secim (yazim) denemez: siparisin kuryesi once okunur', async () => {
    const repository = new InMemoryCourierStore([courier(1), courier(2)], TEST_MARKETS);
    const real = createNearestAvailableStrategy(repository, POOL_RULE);
    let claims = 0;
    const counting: AssignmentStrategy = {
      name: real.name,
      claim: (request) => {
        claims += 1;
        return real.claim(request);
      },
    };
    const lines: LogLine[] = [];
    const assign = createAssignCourier({
      repository,
      markets: repository,
      strategy: counting,
      clock: fixedClock(NOW_MS),
    });
    const order = orderId();
    const command = { orderId: order, marketId: MARKET, deliveryLocation: DELIVERY };

    await assign(command, recordingLogger(lines));
    await assign(command, recordingLogger(lines));

    expect(claims).toBe(1);
    expect(lines.map((line) => line.message)).toEqual([
      'kurye atandi',
      'siparisin kuryesi zaten atanmis',
    ]);
  });

  it('markette bos kurye kalmasa da kuryesi olan siparisin tekrari NOT_FOUND degil, ayni kurye', async () => {
    const { run } = setup([courier(1)]);
    const order = orderId();

    const first = await run(order);

    await expect(run(order)).resolves.toEqual({ ...first, reused: true });
  });

  it('tek bos kurye, ayni siparise eszamanli iki istek: kaybeden de ayni kuryeyi alir (QA B1)', async () => {
    const { run, lines } = setup([courier(1)]);
    const order = orderId();

    // Iki istek de "kuryesi yok" gorur; biri son kuryeyi alir, oburunun secimi bos doner.
    const results = await Promise.all([run(order), run(order)]);

    expect(results.map((result) => result.courier.id)).toEqual([courierId(1), courierId(1)]);
    expect(results.map((result) => result.reused).sort()).toEqual([false, true]);
    expect(lines.map((line) => line.message).sort()).toEqual([
      'eszamanli atamada siparisin kuryesi okundu',
      'kurye atandi',
    ]);
  });

  it('bos kurye yoksa NOT_FOUND (siparis bekler, order 30 sn sonra yeniden dener)', async () => {
    const { run } = setup([courier(1, { status: COURIER_STATUS.OFFLINE })]);

    await expect(run(orderId())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      message: 'Marketin cevresinde uygun kurye yok',
      details: { marketId: MARKET },
    });
  });

  it('baska semtin marketi (havuz disi kurye): NOT_FOUND, kurye degismez', async () => {
    const { run, repository } = setup([courier(1)]);

    await expect(run(orderId(), FAR_MARKET)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { marketId: FAR_MARKET },
    });
    expect((await repository.findById(courierId(1)))?.status).toBe(COURIER_STATUS.IDLE);
  });

  it('market kopyada yok: NOT_FOUND (reason market_unknown) ve WARN; secim denenmez', async () => {
    let claims = 0;
    const counting: AssignmentStrategy = {
      name: 'sayan',
      claim: () => {
        claims += 1;
        return Promise.resolve(null);
      },
    };
    const { run, lines } = setup([courier(1)], counting);
    const order = orderId();

    await expect(run(order, 'mkt_boyle-bir-market-yok')).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { marketId: 'mkt_boyle-bir-market-yok', reason: MARKET_UNKNOWN },
    });
    expect(claims).toBe(0);
    expect(lines).toEqual([
      {
        level: 'warn',
        message: 'market konumu bilinmiyor',
        fields: { orderId: order, marketId: 'mkt_boyle-bir-market-yok' },
      },
    ]);
  });

  it('eszamanli istek kazandiysa (CONFLICT) kazananin kuryesi okunur ve doner', async () => {
    const order = orderId();
    const winner = courier(7, {
      status: COURIER_STATUS.BUSY,
      currentOrderId: order,
      lastAssignedAt: new Date(NOW_MS),
    });
    const repository = new InMemoryCourierStore([courier(1)], TEST_MARKETS);
    const assign = createAssignCourier({
      repository,
      markets: repository,
      // Secim aninda baska istek ayni siparise kurye 7'yi baglamis olur.
      strategy: losingStrategy(() => {
        void repository.replaceAll([courier(1), winner], TEST_MARKETS);
      }),
      clock: fixedClock(NOW_MS),
    });
    const lines: LogLine[] = [];

    const assignment = await assign(
      { orderId: order, marketId: MARKET, deliveryLocation: DELIVERY },
      recordingLogger(lines),
    );

    expect(assignment).toEqual({ courier: winner, etaSeconds: 0, reused: true });
    expect(lines.map((line) => line.message)).toEqual([
      'eszamanli atamada siparisin kuryesi okundu',
    ]);
  });

  it('CONFLICT sonrasi kazanan da yoksa (bu arada birakildi) hata yukari cikar', async () => {
    const { run } = setup(
      [courier(1)],
      losingStrategy(() => undefined),
    );

    await expect(run(orderId())).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('CONFLICT disi hata oldugu gibi yukari cikar', async () => {
    const failing: AssignmentStrategy = {
      name: 'bozuk',
      claim: () => Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'mongo yok')),
    };
    const { run } = setup([courier(1)], failing);

    await expect(run(orderId())).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  });

  it('gunlukte kuryenin adi yok (kisiye ait bilgi), kimligi var', async () => {
    const { run, lines } = setup([courier(1, { name: 'Gizli Ad S.' })]);

    await run(orderId());
    await run(orderId()).catch(() => undefined);

    expect(JSON.stringify(lines)).not.toContain('Gizli Ad');
    expect(JSON.stringify(lines)).toContain(courierId(1));
  });
});

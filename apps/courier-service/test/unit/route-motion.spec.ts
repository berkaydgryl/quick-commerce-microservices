/**
 * Rota hareketinin MOCK altyapisi (T13.3): Redis yok. Tek ornek hep lider,
 * olaylar sozlesmeden gecer ama yayinlanmaz (hata da firlatmaz), canli konum
 * bellekte. Redis modu entegrasyon testinde (redis-route-motion.spec.ts).
 */

import { silentLogger } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { Route } from '../../src/domain/route.js';
import { openRouteMotion } from '../../src/infrastructure/route-motion.js';
import { courierId, DELIVERY, MARKET, NOW_MS, orderId } from '../support/couriers.js';

const MOCK_OPTIONS = { logger: silentLogger, lockTtlMs: 10_000, liveTtlMs: 30_000 };

const route: Route = {
  orderId: orderId(),
  courierId: courierId(1),
  points: [DELIVERY],
  pickupIndex: 0,
  distanceMeters: 0,
  etaSeconds: 0,
  createdAt: new Date(NOW_MS),
  marketId: MARKET,
};

describe('openRouteMotion (MOCK)', () => {
  it('hep lider; olaylar atilir; canli konum bellekte; kapanis bos', async () => {
    const motion = await openRouteMotion(undefined, MOCK_OPTIONS);
    const at = new Date(NOW_MS);

    expect(motion.name).toBe('bellek (MOCK)');
    expect(await motion.lock.hold()).toBe(true);
    await expect(
      motion.events.pickedUp({ ...route, marketId: MARKET }, at),
    ).resolves.toBeUndefined();
    await expect(motion.events.delivered(route, at)).resolves.toBeUndefined();
    await motion.live.save(route.courierId, { location: DELIVERY, at });
    expect(await motion.live.find(route.courierId)).toEqual({ location: DELIVERY, at });
    await expect(motion.close()).resolves.toBeUndefined();
  });

  it('MOCK da da sozlesme disi govde reddedilir (hatta bozuk olay girmez kurali ayni)', async () => {
    const motion = await openRouteMotion(undefined, MOCK_OPTIONS);

    await expect(
      motion.events.delivered({ ...route, courierId: 'crr_bozuk' }, new Date(NOW_MS)),
    ).rejects.toThrow();
  });
});

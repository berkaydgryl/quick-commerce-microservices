/**
 * Persona siparis gecmisi (T8.1): risk-svc'nin persona tablosundaki sayilari
 * uretmeli. Bir tutar ya da sayi degisip persona bandindan kayarsa burasi
 * kirmizi olur (risk-svc test/support/personas.ts ile ayni degerler).
 */

import { idSchema } from '@getir/contracts';
import { ORDER_STATUS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createSeedPersonaOrders } from '../../src/application/seed-persona-orders.js';
import { canTransition } from '../../src/domain/order-state-machine.js';
import type { Order } from '../../src/domain/order.js';
import {
  buildPersonaOrders,
  PERSONA_HISTORIES,
  personaUserIds,
} from '../../src/infrastructure/fixtures/persona-orders.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';

const NOW = new Date('2026-09-29T12:00:00Z');

/** risk-svc persona tablosu: teslim, iptal, ortalama sepet (kurus). */
const EXPECTED = {
  Ayse: { deliveredCount: 5, cancelledCount: 0, averageBasketMinor: 20_000 },
  Zeynep: { deliveredCount: 0, cancelledCount: 0, averageBasketMinor: undefined },
  Can: { deliveredCount: 1, cancelledCount: 3, averageBasketMinor: 12_000 },
  Ali: { deliveredCount: 3, cancelledCount: 1, averageBasketMinor: 18_000 },
  Komsu: { deliveredCount: 12, cancelledCount: 1, averageBasketMinor: 28_000 },
} as const;

async function storeWith(orders: readonly Order[]): Promise<InMemoryOrderStore> {
  const store = new InMemoryOrderStore();
  for (const order of orders) {
    await store.insert(order, []);
  }
  return store;
}

describe('persona siparis gecmisi', () => {
  it('her personanin risk gecmisi tablodaki sayilari verir', async () => {
    const store = await storeWith(buildPersonaOrders(NOW));

    for (const history of PERSONA_HISTORIES) {
      const expected = EXPECTED[history.persona as keyof typeof EXPECTED];
      const got = await store.riskHistory(history.userId);
      expect({ persona: history.persona, ...got }).toEqual({
        persona: history.persona,
        deliveredCount: expected.deliveredCount,
        cancelledCount: expected.cancelledCount,
        ...(expected.averageBasketMinor === undefined
          ? {}
          : { averageBasketMinor: expected.averageBasketMinor }),
      });
    }
  });

  it('Can icin 480 TL ustu sepet ortalamanin dort katini asar (basket-anomaly)', async () => {
    const store = await storeWith(buildPersonaOrders(NOW));
    const can = PERSONA_HISTORIES.find((history) => history.persona === 'Can');
    const history = await store.riskHistory(can?.userId ?? '');

    expect((history.averageBasketMinor ?? 0) * 4).toBe(48_000);
  });

  it('kimlikler gecerli, tekil ve belirlenimci (seed tekrari kopya uretmez)', () => {
    const first = buildPersonaOrders(NOW).map((order) => order.id);
    const later = buildPersonaOrders(new Date('2026-10-15T08:00:00Z')).map((order) => order.id);

    expect(new Set(first).size).toBe(first.length);
    expect(later).toEqual(first);
    for (const id of first) {
      expect(idSchema.safeParse(id).success, id).toBe(true);
    }
    for (const userId of personaUserIds()) {
      expect(idSchema.safeParse(userId).success, userId).toBe(true);
    }
  });

  it('zaman cizelgeleri durum makinesinden gecer ve tutarlar tutarlidir', () => {
    for (const order of buildPersonaOrders(NOW)) {
      const statuses = order.timeline.map((entry) => entry.status);
      expect(statuses[0]).toBe(ORDER_STATUS.DRAFT);
      expect(statuses.at(-1)).toBe(order.status);
      for (let i = 1; i < statuses.length; i += 1) {
        const from = statuses[i - 1];
        const to = statuses[i];
        if (from === undefined || to === undefined) {
          throw new Error('bos durum');
        }
        expect(canTransition(from, to), `${order.id}: ${from} -> ${to}`).toBe(true);
      }
      expect(order.version).toBe(order.timeline.length);
      expect(order.createdAt.getTime()).toBeLessThan(NOW.getTime());
      const lines = order.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
      expect(order.pricing.subtotalMinor).toBe(lines);
      expect(order.pricing.totalMinor).toBe(
        order.pricing.subtotalMinor + order.pricing.deliveryFeeMinor - order.pricing.discountMinor,
      );
    }
  });
});

describe('persona seed use-case', () => {
  it('production ortaminda reddeder ve yazmaz', async () => {
    const writes: unknown[] = [];
    const seed = createSeedPersonaOrders({
      writer: {
        replaceForUsers: (userIds, orders) => {
          writes.push({ userIds, orders });
          return Promise.resolve();
        },
      },
      userIds: personaUserIds(),
      orders: buildPersonaOrders(NOW),
      isProduction: true,
    });

    await expect(seed()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(writes).toHaveLength(0);
  });

  it('personalarin gecmisini tek cagrida yazar ve sayilari doner', async () => {
    const orders = buildPersonaOrders(NOW);
    const calls: { userIds: readonly string[]; orders: readonly Order[] }[] = [];
    const seed = createSeedPersonaOrders({
      writer: {
        replaceForUsers: (userIds, written) => {
          calls.push({ userIds, orders: written });
          return Promise.resolve();
        },
      },
      userIds: personaUserIds(),
      orders,
      isProduction: false,
    });

    await expect(seed()).resolves.toEqual({ users: 5, orders: orders.length });
    expect(calls).toEqual([{ userIds: personaUserIds(), orders }]);
  });
});

describe('MOCK deposu', () => {
  it('gelistirmede persona gecmisini acilista yukler', async () => {
    const lines: LogLine[] = [];
    const store = await openOrderStore(undefined, recordingLogger(lines), 'development');
    const ayse = PERSONA_HISTORIES.find((history) => history.persona === 'Ayse');

    await expect(store.history.riskHistory(ayse?.userId ?? '')).resolves.toMatchObject({
      deliveredCount: 5,
    });
    expect(lines.map((line) => line.message)).toContain(
      'persona siparis gecmisi bellege yuklendi (MOCK)',
    );
  });

  it("production'da yuklemez", async () => {
    const store = await openOrderStore(undefined, recordingLogger([]), 'production');
    const ayse = PERSONA_HISTORIES.find((history) => history.persona === 'Ayse');

    await expect(store.history.riskHistory(ayse?.userId ?? '')).resolves.toEqual({
      deliveredCount: 0,
      cancelledCount: 0,
    });
  });
});

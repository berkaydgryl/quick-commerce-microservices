/**
 * couriers deposu SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration). Her test kendi kuryeleriyle baslar (setup koleksiyonu
 * bastan yazar).
 */

import { ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';
import type { CourierRepository } from '../../src/domain/courier-repository.js';
import { courier, courierId, MARKET, orderId, OTHER_MARKET } from './couriers.js';

export type StoreSetup = (couriers: readonly Courier[]) => Promise<CourierRepository>;

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 4, 9, minute));

export function describeCourierStoreContract(name: string, setup: StoreSetup): void {
  describe(`CourierRepository sozlesmesi: ${name}`, () => {
    it('kurye ALAN KAYBI olmadan okunur; olmayan alan yok kalir', async () => {
      const busy = courier(1, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: orderId(),
        lastAssignedAt: at(5),
      });
      const idle = courier(2);
      const store = await setup([busy, idle]);

      expect(await store.findById(busy.id)).toEqual(busy);
      expect(await store.findById(idle.id)).toEqual(idle);
      expect(Object.keys((await store.findById(idle.id)) ?? {})).not.toContain('currentOrderId');
      expect(await store.findById(courierId(99))).toBeNull();
    });

    it('atama: yalnizca ayni marketin IDLE kuryesi; BUSY ya da OFFLINE ve baska market atlanir', async () => {
      const store = await setup([
        courier(1, { marketId: OTHER_MARKET }),
        courier(2, { status: COURIER_STATUS.OFFLINE }),
        courier(3, {
          status: COURIER_STATUS.BUSY,
          currentOrderId: orderId(),
          lastAssignedAt: at(1),
        }),
        courier(4, { lastAssignedAt: at(30) }),
      ]);
      const order = orderId();

      const claimed = await store.claimLeastRecentlyAssigned({
        marketId: MARKET,
        orderId: order,
        at: at(40),
      });

      expect(claimed).toEqual({
        ...courier(4),
        status: COURIER_STATUS.BUSY,
        currentOrderId: order,
        lastAssignedAt: at(40),
      });
      expect(await store.findById(courierId(4))).toEqual(claimed);
      expect(await store.findByOrder(order)).toEqual(claimed);
    });

    it('sira: hic atanmamis once, sonra en uzun suredir is almamis; esitlikte kimlik', async () => {
      const store = await setup([
        courier(5, { lastAssignedAt: at(10) }),
        courier(4, { lastAssignedAt: at(2) }),
        courier(3),
        courier(2, { lastAssignedAt: at(2) }),
        courier(1),
      ]);

      const picked: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const claimed = await store.claimLeastRecentlyAssigned({
          marketId: MARKET,
          orderId: orderId(),
          at: at(20 + index),
        });
        picked.push(claimed?.id ?? 'yok');
      }

      expect(picked).toEqual([
        courierId(1),
        courierId(3),
        courierId(2),
        courierId(4),
        courierId(5),
      ]);
    });

    it('bos kurye yoksa null; hicbir kurye degismez', async () => {
      const couriers = [
        courier(1, { status: COURIER_STATUS.OFFLINE }),
        courier(2, { marketId: OTHER_MARKET }),
      ];
      const store = await setup(couriers);

      expect(
        await store.claimLeastRecentlyAssigned({ marketId: MARKET, orderId: orderId(), at: at(1) }),
      ).toBeNull();
      expect(await store.findById(courierId(1))).toEqual(couriers[0]);
      expect(await store.findById(courierId(2))).toEqual(couriers[1]);
    });

    it('siparise baska kurye bagliyken ikinci atama CONFLICT; secilecek kurye degismez', async () => {
      const order = orderId();
      const holder = courier(1, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: order,
        lastAssignedAt: at(1),
      });
      const store = await setup([holder, courier(2)]);

      await expect(
        store.claimLeastRecentlyAssigned({ marketId: MARKET, orderId: order, at: at(2) }),
      ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
      expect(await store.findById(courierId(2))).toEqual(courier(2));
      expect(await store.findByOrder(order)).toEqual(holder);
    });

    it('birakma: IDLE olur, siparis bagi silinir, son atama ani kalir; ikinci birakma null', async () => {
      const order = orderId();
      const store = await setup([
        courier(1, { status: COURIER_STATUS.BUSY, currentOrderId: order, lastAssignedAt: at(3) }),
      ]);

      const released = await store.releaseByOrder(order);

      expect(released).toEqual(courier(1, { lastAssignedAt: at(3) }));
      expect(Object.keys(released ?? {})).not.toContain('currentOrderId');
      expect(await store.findByOrder(order)).toBeNull();
      expect(await store.releaseByOrder(order)).toBeNull();
      expect(await store.releaseByOrder(orderId())).toBeNull();
    });

    it('birakilan kurye siranin sonuna gecer; ayni siparis yeniden atanabilir', async () => {
      const store = await setup([courier(1), courier(2)]);
      const first = orderId();

      const a = await store.claimLeastRecentlyAssigned({
        marketId: MARKET,
        orderId: first,
        at: at(1),
      });
      await store.releaseByOrder(first);
      const b = await store.claimLeastRecentlyAssigned({
        marketId: MARKET,
        orderId: first,
        at: at(2),
      });

      expect(a?.id).toBe(courierId(1));
      expect(b?.id).toBe(courierId(2));
      expect((await store.findByOrder(first))?.id).toBe(courierId(2));
    });
  });
}

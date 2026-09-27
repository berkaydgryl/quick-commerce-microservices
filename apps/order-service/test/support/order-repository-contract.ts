/**
 * OrderRepository portunun sozlesmesi: yazma/okuma, cakisma ve iyimser kilit.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { OrderRepository } from '../../src/domain/order-repository.js';
import { TIMELINE_NOTE, transitionOrder } from '../../src/domain/order.js';
import type { OrderStoreFixtures } from './order-store-fixtures.js';
import { START_MS } from './order-store-fixtures.js';

export function describeOrderRepositoryContract(
  name: string,
  getStore: () => OrderRepository,
  { newUserId, draftAt }: OrderStoreFixtures,
): void {
  describe(`OrderRepository sozlesmesi: ${name}`, () => {
    it('yazilan siparis ALAN KAYBI olmadan geri okunur (timeline notu ve tarihler dahil)', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      const walked = transitionOrder(
        draft,
        ORDER_STATUS.RISK_CHECK,
        fixedClock(START_MS + 1_000),
        TIMELINE_NOTE.PENDING_RISK_SERVICE,
      );

      await store.insert(walked);

      const read = await store.findById(walked.id);
      expect(read).toEqual(walked);
      expect(read?.timeline[1]?.at).toBeInstanceOf(Date);
    });

    it('olmayan kimlik: null', async () => {
      await expect(getStore().findById('ord_00000000000000000000000000000000')).resolves.toBeNull();
    });

    it('ayni kimlikle ikinci insert CONFLICT', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft);

      const failing = store.insert(draft);

      await expect(failing).rejects.toBeInstanceOf(AppError);
      await expect(failing).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { orderId: draft.id },
      });
    });

    it('dogru surumle update yazar', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft);

      const cancelled = transitionOrder(draft, ORDER_STATUS.CANCELLED, fixedClock(START_MS + 5));
      await store.update(cancelled, draft.version);

      await expect(store.findById(draft.id)).resolves.toMatchObject({
        status: ORDER_STATUS.CANCELLED,
        version: draft.version + 1,
      });
    });

    it('eski surumle update CONFLICT ve kayit DEGISMEZ (es zamanli iki yazma)', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft);
      // Iki istek ayni taslagi okudu; ilki iptal etti...
      const first = transitionOrder(draft, ORDER_STATUS.CANCELLED, fixedClock(START_MS + 5));
      await store.update(first, draft.version);

      // ...ikincisi hala eski surumu biliyor.
      const second = transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 6));
      const failing = store.update(second, draft.version);

      await expect(failing).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { orderId: draft.id, expectedVersion: draft.version },
      });
      await expect(store.findById(draft.id)).resolves.toMatchObject({
        status: ORDER_STATUS.CANCELLED,
      });
    });

    it('olmayan siparisi update CONFLICT (sessizce yeni kayit ACILMAZ)', async () => {
      const store = getStore();
      const ghost = draftAt(newUserId(), START_MS);

      await expect(store.update(ghost, ghost.version)).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
      });
      await expect(store.findById(ghost.id)).resolves.toBeNull();
    });
  });
}

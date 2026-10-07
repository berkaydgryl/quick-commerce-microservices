/**
 * OrderRepository portunun sozlesmesi: yazma/okuma, cakisma ve iyimser kilit.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { OrderDetails } from '../../src/domain/order-details.js';
import type { Order } from '../../src/domain/order.js';
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
      // Not ve risk bandi (T7.1) istege bagli alanlardir: ikisi de geri okunmali.
      const walked: Order = {
        ...transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 1_000)),
        riskBand: RISK_BANDS.MEDIUM,
      };
      const reserved = transitionOrder(
        walked,
        ORDER_STATUS.RESERVED,
        fixedClock(START_MS + 2_000),
        TIMELINE_NOTE.PENDING_RESERVATION,
      );

      await store.insert(reserved, []);

      const read = await store.findById(reserved.id);
      expect(read).toEqual(reserved);
      expect(read?.timeline[1]?.at).toBeInstanceOf(Date);
    });

    it('siparis ayrintisi (T12.4) update ile yazilir, sonraki gecislerde KAYBOLMAZ', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft, []);
      const details: OrderDetails = {
        gift: {
          message: 'Mutlu yıllar',
          senderName: '',
          recipientName: 'Alıcı Adı',
          recipientPhone: '+905321234567',
        },
        note: 'Zili çalma',
        doNotRingBell: true,
        agreementsAcceptedAt: new Date(START_MS + 1_000),
      };
      const checked: Order = {
        ...transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 1_000)),
        details,
      };
      await store.update(checked, draft.version, []);
      const reserved = transitionOrder(
        checked,
        ORDER_STATUS.RESERVED,
        fixedClock(START_MS + 2_000),
      );
      await store.update(reserved, checked.version, []);

      const read = await store.findById(draft.id);
      expect(read?.details).toEqual(details);
      expect(read?.details?.agreementsAcceptedAt).toBeInstanceOf(Date);

      // Hediyesiz ayrinti: gift alani HIC yok (bos nesne degil).
      const plain = draftAt(newUserId(), START_MS);
      const { gift: _gift, ...withoutGift } = details;
      await store.insert({ ...plain, details: withoutGift }, []);
      const plainRead = await store.findById(plain.id);
      expect(plainRead?.details).toEqual(withoutGift);
      expect(plainRead?.details).not.toHaveProperty('gift');
    });

    it('olmayan kimlik: null', async () => {
      await expect(getStore().findById('ord_00000000000000000000000000000000')).resolves.toBeNull();
    });

    it('ayni kimlikle ikinci insert CONFLICT', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft, []);

      const failing = store.insert(draft, []);

      await expect(failing).rejects.toBeInstanceOf(AppError);
      await expect(failing).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { orderId: draft.id },
      });
    });

    it('dogru surumle update yazar', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft, []);

      const cancelled = transitionOrder(draft, ORDER_STATUS.CANCELLED, fixedClock(START_MS + 5));
      await store.update(cancelled, draft.version, []);

      await expect(store.findById(draft.id)).resolves.toMatchObject({
        status: ORDER_STATUS.CANCELLED,
        version: draft.version + 1,
      });
    });

    it('eski surumle update CONFLICT ve kayit DEGISMEZ (es zamanli iki yazma)', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft, []);
      // Iki istek ayni taslagi okudu; ilki iptal etti...
      const first = transitionOrder(draft, ORDER_STATUS.CANCELLED, fixedClock(START_MS + 5));
      await store.update(first, draft.version, []);

      // ...ikincisi hala eski surumu biliyor.
      const second = transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 6));
      const failing = store.update(second, draft.version, []);

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

      await expect(store.update(ghost, ghost.version, [])).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
      });
      await expect(store.findById(ghost.id)).resolves.toBeNull();
    });
  });
}

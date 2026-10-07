/**
 * Siparis ayrintisinin Mongo eslemesi (T12.4): belgeye yalnizca bilinen alanlar
 * girer, geri okuma alan kaybetmez; ayrintisiz sipariste alan HIC yazilmaz.
 * (Gercek Mongo ile gidis-donus: order-repository-contract.ts, test:int.)
 */

import { fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { OrderDetails } from '../../src/domain/order-details.js';
import { fromOrderDocument, toOrderDocument } from '../../src/infrastructure/mongo/mappers.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { insertDraft } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);
const DETAILS: OrderDetails = {
  gift: {
    message: 'Mutlu yıllar',
    senderName: 'Gönderen',
    recipientName: 'Alıcı',
    recipientPhone: '+905321234567',
  },
  note: 'Zili çalma',
  doNotRingBell: true,
  agreementsAcceptedAt: clock.date(),
};

describe('Mongo eslemesi: siparis ayrintisi', () => {
  it('belgede alanlar birebir; geri okuma ayni siparis', async () => {
    const order = { ...(await insertDraft(new InMemoryOrderStore(), clock)), details: DETAILS };

    const document = toOrderDocument(order);

    expect(document.details).toEqual(DETAILS);
    expect(fromOrderDocument(document)).toEqual(order);
  });

  it('domain nesnesindeki bilinmeyen alan belgeye GIRMEZ (alanlar tek tek kopyalanir)', async () => {
    const leaky = { ...DETAILS, agreementsAccepted: true, cardToken: 'tok_test_4242' };
    const order = { ...(await insertDraft(new InMemoryOrderStore(), clock)), details: leaky };

    expect(JSON.stringify(toOrderDocument(order).details)).not.toMatch(/agreementsAccepted"|tok_/);
  });

  it('ayrintisiz siparis: belgede details alani HIC yok', async () => {
    const order = await insertDraft(new InMemoryOrderStore(), clock);

    expect(toOrderDocument(order)).not.toHaveProperty('details');
    expect(fromOrderDocument(toOrderDocument(order))).not.toHaveProperty('details');
  });
});

describe('Mongo eslemesi: odeme secimi (T12.4)', () => {
  it.each([[{ method: 'CASH_ON_DELIVERY', onDelivery: 'POS' }], [{ method: 'CARD' }]] as const)(
    '%o: belgede birebir, geri okuma ayni',
    async (payment) => {
      const order = { ...(await insertDraft(new InMemoryOrderStore(), clock)), payment };

      const document = toOrderDocument(order);

      expect(document.payment).toEqual(payment);
      expect(fromOrderDocument(document)).toEqual(order);
    },
  );

  it('kartta tur alani belgede HIC yok; secimsiz (eski) sipariste payment yok', async () => {
    const draft = await insertDraft(new InMemoryOrderStore(), clock);

    expect(toOrderDocument({ ...draft, payment: { method: 'CARD' } }).payment).not.toHaveProperty(
      'onDelivery',
    );
    expect(toOrderDocument(draft)).not.toHaveProperty('payment');
  });
});

/**
 * Iptal yolunun Mongo filtreleri (#174, #177): birim testte filtrenin SEKLI,
 * calisan sorgu ve plani test/integration/mongo-courier-store.spec.ts'te.
 */

import { describe, expect, it } from 'vitest';

import {
  RELEASE_BY_COURIER_HINT,
  releaseFilter,
} from '../../src/infrastructure/mongo/couriers-collection.js';
import { currentRouteFilter } from '../../src/infrastructure/mongo/routes-collection.js';

const CURRENT = {
  _id: 'ord_0123456789abcdef0123456789abcdef',
  courierId: 'crr_0123456789abcdef0123456789abcdef',
  createdAt: new Date('2026-10-08T09:00:00.000Z'),
};

describe('birakma filtresi (#174)', () => {
  it('kurye kimligiyle: {_id, currentOrderId} ve _id indeksi ipucu', () => {
    expect(releaseFilter('ord_1', 'crr_1')).toEqual({ _id: 'crr_1', currentOrderId: 'ord_1' });
    expect(RELEASE_BY_COURIER_HINT).toEqual({ _id: 1 });
  });

  it('kurye kimligi yoksa siparisi tasiyan kurye (eski cagiranlar)', () => {
    expect(releaseFilter('ord_1')).toEqual({ currentOrderId: 'ord_1' });
  });
});

describe('rota yama filtresi (#177)', () => {
  it('ENDED (iptal) yamasi: ayni rota, bitmemis VE teslim ani kayitli degil', () => {
    expect(currentRouteFilter(CURRENT, true)).toEqual({
      ...CURRENT,
      state: { $nin: ['DONE', 'ENDED'] },
      deliveredAt: { $exists: false },
    });
  });

  it('diger yamalar: teslim kosulu yok (tick teslimi ve yayini isaretler)', () => {
    expect(currentRouteFilter(CURRENT, false)).toEqual({
      ...CURRENT,
      state: { $nin: ['DONE', 'ENDED'] },
    });
  });
});

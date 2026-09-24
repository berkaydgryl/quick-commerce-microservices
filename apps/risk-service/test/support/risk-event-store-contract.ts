/**
 * risk_events deposu SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration). Mongo'da koleksiyon paylasilir; her test kendi
 * kullanicisini acar.
 */

import { RISK_BANDS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { RiskEvent } from '../../src/domain/risk-event.js';
import type { RiskEventRepository } from '../../src/domain/risk-event-repository.js';

const START_MS = 1_760_000_000_000;

export function describeRiskEventStoreContract(
  name: string,
  getStore: () => RiskEventRepository,
): void {
  let counter = 0;
  const newUser = (): string => {
    counter += 1;
    return `usr_contract-${name}-${counter}`;
  };

  const event = (userId: string, offsetMs: number, fields: Partial<RiskEvent> = {}): RiskEvent => ({
    id: `rev_${name}-${counter}-${offsetMs}`,
    userId,
    score: 35,
    band: RISK_BANDS.MEDIUM,
    hits: [
      {
        ruleId: 'account-age',
        hit: true,
        weight: 20,
        score: 20,
        reason: 'hesap 1 saatlik',
        veto: false,
      },
      {
        ruleId: 'ip-device',
        hit: false,
        weight: 15,
        score: 0,
        reason: 'cihaz ve IP olagan',
        veto: false,
      },
    ],
    evaluatedAt: new Date(START_MS + offsetMs),
    ...fields,
  });

  describe(`RiskEventRepository sozlesmesi: ${name}`, () => {
    it('yazilan kayit ALAN KAYBI olmadan geri okunur (veto ve siparis dahil)', async () => {
      const store = getStore();
      const userId = newUser();
      const vetoed = event(userId, 0, {
        orderId: 'ord_1',
        marketId: 'mkt_migros-jet-moda',
        score: 45,
        band: RISK_BANDS.CRITICAL,
        vetoedByRuleId: 'ip-device',
      });

      await store.insert(vetoed);

      expect(await store.findLatest({ userId })).toEqual(vetoed);
    });

    it('istege bagli alanlar yoksa geri okunan kayitta da yoktur', async () => {
      const store = getStore();
      const userId = newUser();
      const plain = event(userId, 0);
      await store.insert(plain);

      const read = await store.findLatest({ userId });
      expect(read).toEqual(plain);
      expect(read !== null && 'orderId' in read).toBe(false);
    });

    it('kullanicinin EN YENI degerlendirmesini doner', async () => {
      const store = getStore();
      const userId = newUser();
      await store.insert(event(userId, 1_000, { score: 10, band: RISK_BANDS.LOW }));
      await store.insert(event(userId, 3_000, { score: 70, band: RISK_BANDS.HIGH }));
      await store.insert(event(userId, 2_000, { score: 35 }));

      expect((await store.findLatest({ userId }))?.score).toBe(70);
    });

    it('siparis verilirse o siparisin en yeni degerlendirmesini doner (saga iki kez puanlar)', async () => {
      const store = getStore();
      const userId = newUser();
      await store.insert(event(userId, 1_000, { orderId: 'ord_a', score: 20 }));
      await store.insert(event(userId, 2_000, { orderId: 'ord_a', score: 35 }));
      await store.insert(event(userId, 3_000, { orderId: 'ord_b', score: 70 }));

      expect((await store.findLatest({ userId, orderId: 'ord_a' }))?.score).toBe(35);
      expect((await store.findLatest({ userId }))?.orderId).toBe('ord_b');
    });

    it('baska kullanicinin siparisi okunmaz; kayit yoksa null', async () => {
      const store = getStore();
      const owner = newUser();
      await store.insert(event(owner, 0, { orderId: 'ord_ozel' }));

      expect(await store.findLatest({ userId: newUser(), orderId: 'ord_ozel' })).toBeNull();
      expect(await store.findLatest({ userId: newUser() })).toBeNull();
    });
  });
}

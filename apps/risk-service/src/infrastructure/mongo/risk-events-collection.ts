/**
 * risk_events sorgulari ve indeksleri: yalnizca BELGE okur-yazar. Koleksiyonun
 * TEK sahibi risk-service'tir (ADR-05); digerleri GetLastEvaluation ile okur.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { Db, Filter, IndexDescription } from 'mongodb';

import type { RiskEventDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/** En yeni once; ayni milisaniyede kimlik azalan (belirlenebilir sira). */
const LATEST_FIRST = { createdAt: -1, _id: -1 } as const;

export class RiskEventsCollection extends MongoRepository<RiskEventDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.RISK_EVENTS);
  }

  protected override indexes(): readonly IndexDescription[] {
    return [
      // Kullanicinin son degerlendirmesi (roadmap: userId+createdAt).
      { key: { userId: 1, createdAt: -1 }, name: 'userId_createdAt' },
      // Bir siparisin son degerlendirmesi (siparis basina bir kez puanlanir; ayni siparise
      // yeniden kayit dusse en yenisi okunur).
      // Siparissiz kayitlar (orderId yok) bu indekse girmez.
      {
        key: { orderId: 1, createdAt: -1 },
        name: 'orderId_createdAt',
        partialFilterExpression: { orderId: { $exists: true } },
      },
    ];
  }

  async findLatest(filter: Filter<RiskEventDocument>): Promise<RiskEventDocument | null> {
    return this.run('findLatest', () =>
      this.collection.find(filter).sort(LATEST_FIRST).limit(1).next(),
    );
  }

  /**
   * Kullanicinin `since`'ten bu yana bandi en yuksek TEK kaydi (#164): vetolu kayit
   * once (BSON'da metin eksik alandan buyuk; vetolular kural kimligine gore), sonra
   * skor, sonra en yeni, sonra kimlik. Suzme userId_createdAt indeksiyle; siralama o
   * kullanicinin penceredeki kayitlari uzerinde (siparis hiz siniriyla sinirli).
   * `timeoutMs` verilirse ISLEM BASINA surucu siniri (CSOT): sure dolunca surucu
   * islemi birakir, baglanti veritabani duzeyindeki sinir (2 sn) kadar tutulmaz.
   */
  async findHighestRecent(
    userId: string,
    since: Date,
    timeoutMs?: number,
  ): Promise<RiskEventDocument | null> {
    const { filter, sort } = highestRecentQuery(userId, since);
    return this.run('findHighestRecent', () =>
      this.collection
        .find(filter, timeoutMs === undefined ? {} : { timeoutMS: timeoutMs })
        .sort(sort)
        .limit(1)
        .next(),
    );
  }
}

/**
 * findHighestRecent'in sorgusu TEK yerde: entegrasyon testindeki explain ayni
 * sorgunun userId_createdAt indeksini kullandigini dogrular (COLLSCAN yok).
 */
export function highestRecentQuery(userId: string, since: Date) {
  return {
    filter: { userId, createdAt: { $gte: since } },
    sort: { vetoedByRuleId: -1, score: -1, createdAt: -1, _id: -1 },
  } as const;
}

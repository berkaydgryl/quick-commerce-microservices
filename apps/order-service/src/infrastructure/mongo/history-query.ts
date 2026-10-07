/**
 * Gecmis Siparislerim sorgusu (ListMyOrders, #101): filtre, sira ve kismi indeks.
 *
 * orders-collection.ts okur; entegrasyon testi AYNI imleci explain eder (sorgu
 * testte kopyalanmaz). Domain tipini bilmez; gorunurluk kurali belgeye
 * `inHistory` olarak eslemede yazilir (mappers.ts).
 */

import type { Collection, Filter, FindCursor, IndexDescription, WithId } from 'mongodb';

import type { OrderHistoryCursor } from '../../domain/order-history-cursor.js';
import type { OrderDocument } from './documents.js';

/** Gecmis sirasi: yeniden eskiye, esitlikte kimlik azalan (domain comesBefore ile ayni). */
const HISTORY_SORT = { createdAt: -1, _id: -1 } as const;

export const HISTORY_INDEX_NAME = 'userId_createdAt_id_inHistory';

/**
 * KISMI: yalnizca gecmiste gorunen siparisler (`inHistory: true`) indekse
 * girer; sepet taslaklari ve odenmeden kapananlar girmez. Sayfa tam dolar ve
 * okunan belge donen satir kadardir: gizli siparis okunup atilmaz.
 *
 * Anahtar tam indeksle (userId_createdAt_id) ayni; o indeks userId onekli
 * diger okumalar (risk gecmisi, ILK10, persona seed'i) icin kalir.
 */
export const HISTORY_INDEX: IndexDescription = {
  key: { userId: 1, createdAt: -1, _id: -1 },
  name: HISTORY_INDEX_NAME,
  partialFilterExpression: { inHistory: true },
};

/**
 * Kullanicinin gecmiste gorunen siparisleri, imlecten sonrakiler, en fazla
 * `limit` belge. Indeks ADIYLA istenir: ayni anahtarli tam indeks de sorguya
 * uyar; plan yarisi esit biterse planlayici onu secip onbellege alabilir ve
 * gizli siparisler okunup atilirdi. Bedeli: indeks yoksa sorgu yavaslamaz,
 * HATA verir. Indeks acilista kurulur (order-store.ts); goc 0002 geri alininca
 * (indeks ve alan duser) eski kod beklenir, yeni kod zaten bos liste okurdu.
 */
export function findHistoryCursor(
  collection: Collection<OrderDocument>,
  userId: string,
  after: OrderHistoryCursor | undefined,
  limit: number,
): FindCursor<WithId<OrderDocument>> {
  return collection
    .find(historyFilter(userId, after))
    .sort(HISTORY_SORT)
    .hint(HISTORY_INDEX_NAME)
    .limit(limit);
}

/** Kullanicinin gecmiste gorunen siparisleri, imlecten sonrakiler. */
export function historyFilter(
  userId: string,
  after: OrderHistoryCursor | undefined,
): Filter<OrderDocument> {
  return { userId, inHistory: true, ...afterFilter(after) };
}

/**
 * Imlecten SONRAKI kayitlar (yeniden eskiye): daha eski, ya da ayni an ve daha
 * kucuk kimlik. Ustteki `createdAt <= imlec` indeks araligini imlecle sinirlar:
 * onceki sayfalarin anahtarlari yeniden taranmaz; `$or` yalnizca esit andaki
 * kimligi ayirir.
 */
function afterFilter(after: OrderHistoryCursor | undefined): Filter<OrderDocument> {
  if (after === undefined) {
    return {};
  }
  return {
    createdAt: { $lte: after.createdAt },
    $or: [
      { createdAt: { $lt: after.createdAt } },
      { createdAt: after.createdAt, _id: { $lt: after.orderId } },
    ],
  };
}

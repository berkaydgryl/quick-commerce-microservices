/**
 * Goc 0001 (T10.4; verisi T9.4'ten): tekliflerin arama terimleri Turkce
 * karakter katlamasiyla yazilir ("Çikolata" -> "cikolata"). T9.4 oncesi
 * yazilmis terimler katlanmamisti; katlanmis sorgu onlari bulamaz ve arama
 * sessizce eksik sonuc verirdi. Bu goc, acilistaki "pnpm seed calistirin"
 * uyarisinin yerini alir.
 *
 * Mantik o gunun DONMUS kopyasidir (ADR-19): domain'deki searchKey sonradan
 * degisse de bu goc degismez. Koleksiyon adi da ayni sebeple burada yazili.
 *
 *   up   : terimler katlanir. Katlanmis terim degismez: tekrar calismasi zararsiz.
 *   down : T9.4 oncesi bicim (kucuk harf, katlamasiz) teklifteki urun kopyasinin
 *          adindan ve aciklamasindan yeniden yazilir; katlama geri cevrilemez.
 */

import type { Migration, MigrationContext } from '@getir/mongo-kit';
import type { AnyBulkWriteOperation } from 'mongodb';

const OFFERS = 'offers';

interface OfferTerms {
  _id: string;
  searchTerms: string[];
  product: { name: string; description: string };
}

/** T9.4'ten beri searchKey: kucuk harf, isaretler atilir, noktasiz i katlanir. */
function foldedKey(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i');
}

/** T9.4 oncesi searchKey: yalnizca kucuk harf. */
function legacyKey(text: string): string {
  return text.trim().toLocaleLowerCase('tr');
}

function sameTerms(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((term, index) => term === right[index]);
}

/** Butun tekliflerin terimlerini yeniden yazar; yalnizca degisenler, tek toplu yazimla. */
async function rewriteTerms(
  context: MigrationContext,
  termsOf: (offer: OfferTerms) => string[],
): Promise<void> {
  const offers = context.db.collection<OfferTerms>(OFFERS);
  const session = context.session === undefined ? {} : { session: context.session };
  const all = await offers
    .find({}, { projection: { searchTerms: 1, product: 1 }, ...session })
    .toArray();
  const updates: AnyBulkWriteOperation<OfferTerms>[] = all.flatMap((offer) => {
    const next = termsOf(offer);
    return sameTerms(next, offer.searchTerms)
      ? []
      : [{ updateOne: { filter: { _id: offer._id }, update: { $set: { searchTerms: next } } } }];
  });
  if (updates.length > 0) {
    await offers.bulkWrite(updates, { ordered: false, ...session });
  }
  context.logger.info(
    { changed: updates.length, offers: all.length },
    'arama terimleri yeniden yazildi',
  );
}

export const foldSearchTerms: Migration = {
  version: 1,
  name: 'arama-terimlerini-katla',
  up: (context) => rewriteTerms(context, (offer) => offer.searchTerms.map(foldedKey)),
  down: (context) =>
    rewriteTerms(context, (offer) => [
      legacyKey(offer.product.name),
      legacyKey(offer.product.description),
    ]),
};

/**
 * Stok alan modeli (ADR-03): kalici gercek Mongo'da (`stock`), sicak yolun
 * karar merci Redis'teki sayactir (`stock:{market}:avail:{sku}`).
 *
 * Burada depo, sorgu ya da protokol yoktur; yalnizca kavramlar ve portlar.
 */

/** Bir marketin bir SKU'su icin eldeki adet (Mongo `stock` kaydi). */
export interface StockLevel {
  readonly marketId: string;
  readonly sku: string;
  /** Eldeki adet; rezervasyonlar DUSULMEMISTIR (onlar sayactan duser, T10). */
  readonly onHand: number;
}

/** Hizli sayacin okunmasi: CheckAvailability'nin tek kaynagi. */
export interface StockCounterReader {
  /**
   * Verilen SKU'larin satilabilir adetleri. Sayaci OLMAYAN SKU haritada
   * yoktur: "bu markette satilmiyor" ile "tukendi" (0) ayrimi buradan cikar.
   */
  available(marketId: string, skus: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

/**
 * Sayacin yazilma bicimi:
 *   - missing: yalnizca OLMAYAN sayac yazilir (acilis). Var olan sayac
 *     rezervasyonlari yansitir (T10); ezilirse ayrilmis stok yeniden satilirdi.
 *   - overwrite: hepsi Mongo'dan bastan yazilir (reseed: Redis bosaltildiginda
 *     ya da seed sonrasinda, bilincli).
 */
export type CounterSeedMode = 'missing' | 'overwrite';

/** Sayaclarin yazilmasi. Donen deger fiilen yazilan sayac sayisidir. */
export interface StockCounterWriter {
  write(levels: readonly StockLevel[], mode: CounterSeedMode): Promise<number>;
}

/** Kalici stok kayitlarinin kacar kacar okunmasi (butun koleksiyon bellege alinmaz). */
export interface StockLevelSource {
  batches(batchSize: number): AsyncIterable<readonly StockLevel[]>;
}

/**
 * Sayac kumesinin Redis'te yerinde olup olmadigi (T10.1 PR 2, ADR-17). Isaret
 * sayaclar Mongo'dan yazildiktan SONRA konur; yoksa Redis bosalmistir.
 */
export interface CounterSetMarker {
  isPresent(): Promise<boolean>;
  markPresent(): Promise<void>;
}

/**
 * Bir sayac bulunamadiginda cagrilir: Redis bosalmissa sayaclari yeniden kurar
 * ve true doner (okuma BIR KEZ tekrarlanmali); bosalmamissa false (SKU
 * gercekten bu markette yok).
 */
export type CounterRecovery = () => Promise<boolean>;

/** Seed'in ihtiyaci: kalici stogu bastan yazmak. */
export interface StockSeedWriter {
  replaceAll(levels: readonly StockLevel[]): Promise<void>;
}

/** Stogu olan marketler (supurucu, T10.3): market basina ayri sure indeksi var. */
export interface StockMarketSource {
  marketIds(): Promise<readonly string[]>;
}

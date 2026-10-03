/**
 * Son yayinlanan surumun deposu (T12.3): port. Uygulamasi Redis'tedir
 * (infrastructure/redis-seq-store.ts); kopyalar ayni degeri gorur.
 */
export interface SeqStore {
  /**
   * `seq`'i, kayitlidan BUYUKSE kaydeder ve kayitli ONCEKI degeri doner (hic
   * yoksa undefined). Karsilastirma ve yazma tek atomik adimdir: iki kopya ayni
   * anda yazsa da kayit en buyuk degerde kalir.
   */
  recordIfNewer(orderId: string, seq: number): Promise<number | undefined>;
}

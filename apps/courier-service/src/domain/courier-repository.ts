/**
 * couriers deposu portu. MOCK'ta bellek, aksi halde Mongo; ikisi ayni sozlesme
 * testinden gecer (test/support/courier-store-contract.ts).
 */

import type { Courier } from './courier.js';

export interface ClaimRequest {
  readonly marketId: string;
  readonly orderId: string;
  readonly at: Date;
}

export interface CourierRepository {
  findById(id: string): Promise<Courier | null>;

  /** Siparisi tasiyan kurye; en fazla bir tane vardir (benzersiz indeks). */
  findByOrder(orderId: string): Promise<Courier | null>;

  /**
   * Marketin IDLE kuryelerinden en uzun suredir atanmamis olani TEK ATOMIK
   * adimda BUSY yapar, siparise baglar ve atama anini yazar (B7). Sira:
   * lastAssignedAt artan (hic atanmamis once), esitlikte kimlik.
   *
   * @returns Atanan kurye; marketin bos kuryesi yoksa null.
   * @throws AppError CONFLICT: siparise baska bir kurye zaten bagli (eszamanli
   *         ikinci istek); kurye degismez.
   */
  claimLeastRecentlyAssigned(request: ClaimRequest): Promise<Courier | null>;

  /**
   * Siparisi tasiyan kuryeyi IDLE'a dondurur, siparis bagini siler.
   * lastAssignedAt KALIR: yeni bosalan kurye siranin sonuna gecer.
   * @returns Birakilan kurye; siparisi tasiyan kurye yoksa null.
   */
  releaseByOrder(orderId: string): Promise<Courier | null>;
}

/** Seed yazicisi: kuryeleri bastan yazar (eskiler silinir). */
export interface CourierSeedWriter {
  replaceAll(couriers: readonly Courier[]): Promise<void>;
}

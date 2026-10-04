/**
 * couriers deposu portu. MOCK'ta bellek, aksi halde Mongo; ikisi ayni sozlesme
 * testinden gecer (test/support/courier-store-contract.ts).
 */

import type { Courier, GeoPoint } from './courier.js';
import type { PoolRule } from './courier-pool.js';
import type { MarketLocation } from './market-locator.js';

export interface NearestClaimRequest {
  readonly orderId: string;
  /** Siparisin marketinin konumu: havuzun merkezi. */
  readonly near: GeoPoint;
  readonly rule: PoolRule;
  readonly at: Date;
}

export interface CourierRepository {
  findById(id: string): Promise<Courier | null>;

  /** Siparisi tasiyan kurye; en fazla bir tane vardir (benzersiz indeks). */
  findByOrder(orderId: string): Promise<Courier | null>;

  /**
   * Havuzdan (courier-pool.ts) sira kuralina gore ilk uygun kuryeyi siparise
   * baglar: BUSY yapar, siparisi ve atama anini yazar, idleSince'i siler.
   *
   * ATOMIK (B7): kurye ancak HALA IDLE ise alinir (kosullu yazim); iki siparis
   * ayni kuryeyi alamaz. Aday baskasina gittiyse siradakine gecilir.
   *
   * @returns Atanan kurye; havuzda bos kurye yoksa null.
   * @throws AppError CONFLICT: siparise baska bir kurye zaten bagli (eszamanli
   *         ikinci istek); kurye degismez.
   */
  claimNearest(request: NearestClaimRequest): Promise<Courier | null>;

  /**
   * Siparisi tasiyan kuryeyi IDLE'a dondurur, siparis bagini siler ve bosta
   * beklemeye `at`'te baslatir (idleSince). lastAssignedAt ve konum KALIR:
   * kurye oldugu yerde bekler.
   * @returns Birakilan kurye; siparisi tasiyan kurye yoksa null.
   */
  releaseByOrder(orderId: string, at: Date): Promise<Courier | null>;
}

/** Seed yazicisi: kuryeleri ve market konumlarini bastan yazar (eskiler silinir). */
export interface CourierSeedWriter {
  replaceAll(couriers: readonly Courier[], markets: readonly MarketLocation[]): Promise<void>;
}

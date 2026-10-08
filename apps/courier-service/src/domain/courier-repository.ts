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
   * beklemeye `at`'te baslatir (idleSince). lastAssignedAt KALIR.
   * @returns Birakilan kurye; siparisi tasiyan (verildiyse BU) kurye yoksa null.
   */
  releaseByOrder(orderId: string, at: Date, options?: ReleaseOptions): Promise<Courier | null>;
}

/**
 * Siparis tasiyan kuryeleri TOPLU okur (#205 uzlastirma). Ayri port: yalnizca
 * tick'in ihtiyaci.
 */
export interface CarrierReader {
  /**
   * Bir siparisi tasiyan (currentOrderId dolu) kuryeler, SIPARIS kimligine gore
   * artan, `afterOrderId`'den sonrakiler, en fazla `limit` (sayfa). Cagiran
   * sayfalari dolasir ve basa doner: atlanan kuryeler pencereyi kilitlemez.
   */
  listCarrying(limit: number, afterOrderId?: string): Promise<readonly Courier[]>;
}

/**
 * Kuryeleri kimlikleriyle TOPLU okur (T13.3 tick: rota basina okuma yok, N+1
 * yasak). Ayri port: yalnizca tick'in ihtiyaci; depo uygulamalari ikisini de
 * saglar.
 */
export interface CourierBatchReader {
  /** Bulunanlar; olmayan kimlik sessizce atlanir, sira garanti degil. */
  findByIds(ids: readonly string[]): Promise<readonly Courier[]>;
}

export interface ReleaseOptions {
  /**
   * Kuryenin bosa ciktigi yer (T13.3): teslimatta teslimat noktasi, iptalde
   * rotadaki hesaplanan anlik konum (#174). Verilmezse konum KALIR (rotasiz
   * atama).
   */
  readonly location?: GeoPoint;
  /**
   * Yalnizca siparisi BU kurye tasiyorsa birakir ({_id, currentOrderId}, _id
   * indeksi; #174). Tick ve ReleaseCourier bunu verir: arada kurye degistiyse
   * kimse birakilmaz.
   */
  readonly courierId?: string;
}

/** Seed yazicisi: kuryeleri ve market konumlarini bastan yazar (eskiler silinir). */
export interface CourierSeedWriter {
  replaceAll(couriers: readonly Courier[], markets: readonly MarketLocation[]): Promise<void>;
}

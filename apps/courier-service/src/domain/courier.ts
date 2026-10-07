/**
 * Kurye: saf veri, I/O yok. couriers koleksiyonunun TEK sahibi bu servistir
 * (ADR-05); order kuryeyi yalnizca RPC ile ister ve birakir.
 *
 * Kurye bir markete BAGLI DEGILDIR (T13.2, ortak havuz): siparisin marketinin
 * cevresindeki bos kuryelerden biri atanir (courier-pool.ts).
 */

/** Kuryenin musaitligi; proto CourierStatus ile ayni anlam. */
export const COURIER_STATUS = {
  /** Atanmaya hazir. */
  IDLE: 'IDLE',
  /** Bir siparise bagli. */
  BUSY: 'BUSY',
  /** Vardiya disi; atama havuzuna girmez. */
  OFFLINE: 'OFFLINE',
} as const;

export type CourierStatus = (typeof COURIER_STATUS)[keyof typeof COURIER_STATUS];

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface Courier {
  /** crr_<32 hex>; sozlesmedeki kimlik bicimi (idSchema). */
  readonly id: string;
  /**
   * Istemcide gosterilecek ad ("Mehmet K."). Gunluge YAZILMAZ: kisiye ait
   * bilgidir, gunlukte kimlik yeter.
   */
  readonly name: string;
  readonly status: CourierStatus;
  /** Yalnizca BUSY iken: tasidigi siparis. Bir siparisi en fazla bir kurye tasir. */
  readonly currentOrderId?: string;
  /**
   * Son atama ani (gecmis bilgisi). Hic atanmamis kuryede yoktur; birakmada
   * SILINMEZ. Secim sirasi bundan DEGIL, idleSince'ten (#88).
   */
  readonly lastAssignedAt?: Date;
  /**
   * Yalnizca IDLE iken: bosta beklemeye basladigi an (seed ya da birakma).
   * Ayni yakinlik dilimindeki kuryelerden en uzun suredir bosta olan once
   * secilir (T13.2, #88). Atamada silinir.
   */
  readonly idleSince?: Date;
  /**
   * Son bilinen konum ve ani. Havuz secimi bu konuma gore yapilir. Mongo'daki
   * deger yalnizca durum degisiminde yazilir (seed'de bir marketin yakini;
   * teslimat bitince adres, T13.3/T14.3); canli konum her tick'te Redis'e
   * gider (T14.1) ve Mongo'ya yazilmaz. Teslimattan sonra kurye oldugu yerde
   * IDLE kalir, markete donmez.
   */
  readonly lastLocation: GeoPoint;
  readonly lastLocationAt: Date;
}

/**
 * Kurye bu siparisi TASIYOR mu (BUSY ve bagli). Atama, rota, tick ve takip ayni
 * kurali kullanir: biri degisirse digerleri ayrismasin.
 */
export function carriesOrder(courier: Courier | null | undefined, orderId: string): boolean {
  return courier?.status === COURIER_STATUS.BUSY && courier.currentOrderId === orderId;
}

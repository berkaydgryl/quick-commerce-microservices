/**
 * Kurye: saf veri, I/O yok. couriers koleksiyonunun TEK sahibi bu servistir
 * (ADR-05); order kuryeyi yalnizca RPC ile ister ve birakir.
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
  /** Bagli oldugu market (ADR-15); atama yalnizca ayni market icinde. */
  readonly marketId: string;
  readonly status: CourierStatus;
  /** Yalnizca BUSY iken: tasidigi siparis. Bir siparisi en fazla bir kurye tasir. */
  readonly currentOrderId?: string;
  /**
   * Son atama ani. Adil sira bundan: en uzun suredir is almamis kurye once.
   * Hic atanmamis kuryede yoktur (sirada en one gecer). Birakmada SILINMEZ.
   */
  readonly lastAssignedAt?: Date;
  /**
   * Son bilinen konum ve ani. Mongo'daki deger yalnizca durum degisiminde
   * yazilir (seed'de marketin konumu); canli konum her tick'te Redis'e gider
   * (T13.3, T14.1) ve Mongo'ya yazilmaz.
   */
  readonly lastLocation: GeoPoint;
  readonly lastLocationAt: Date;
}

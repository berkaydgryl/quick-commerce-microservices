/**
 * Siparise yazilan, fiyati DONDURULMUS kalem ve siparisin tutari (T7.2).
 *
 * Urun adi, birimi ve fiyati burada KOPYA olarak durur: catalog'daki kayit
 * sonradan degisse bile gecmis siparis oldugu gibi kalmalidir (proto OrderItem).
 * Tutarlar KURUS cinsinden tam sayidir; para birimi siparis basina tektir.
 */

/** Kalemin gosterim birimi ("2 paket"); stok hesabi icin degil. */
export const ITEM_UNIT = {
  UNSPECIFIED: 'UNSPECIFIED',
  PIECE: 'PIECE',
  KILOGRAM: 'KILOGRAM',
  LITER: 'LITER',
  PACK: 'PACK',
} as const;

export type ItemUnit = (typeof ITEM_UNIT)[keyof typeof ITEM_UNIT];

export interface OrderItem {
  readonly productId: string;
  /** Stok anahtari; DEGERI catalog'dan gelir (istemcinin yazdigi degil). */
  readonly sku: string;
  readonly name: string;
  readonly unit: ItemUnit;
  readonly quantity: number;
  /** Siparis anindaki birim liste fiyati (kurus). */
  readonly unitPriceMinor: number;
  /** unitPriceMinor * quantity (kurus); yuvarlama tek yerde, burada. */
  readonly lineTotalMinor: number;
}

/**
 * Siparisin dondurulmus tutari: web'deki sepetle AYNI hesap (@getir/pricing
 * calculateCart). totalMinor = subtotal + deliveryFee - discount; odenecek tutar.
 */
export interface OrderPricing {
  /** ISO-4217 (bugun yalnizca TRY); catalog tekliflerinden gelir. */
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly deliveryFeeMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  /** Uygulanan kupon (normallestirilmis, ornek ILK10); kupon yoksa alan yok. */
  readonly couponCode?: string;
}

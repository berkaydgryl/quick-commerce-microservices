/**
 * Dinlemenin ince ayarlari (ADR-07: tasimaya ozgu ayarlar arayuzun DISINDA,
 * yapilandirmayla verilir). Varsayilanlar payment'in iade komutu icin
 * secildi; realtime (T12.3) gibi dusuk gecikme isteyen tuketici kendi
 * degerini verir.
 */

/** Grup ILK KEZ kurulurken nereden okunacagi; var olan grubun konumu degismez. */
export const GROUP_START = {
  /** Akisin basindan: tuketici kapaliyken birakilmis komutlar kaybolmaz. */
  BEGINNING: 'beginning',
  /** Yalnizca bundan sonra gelenler: eski olayin anlami olmayan bildirimler icin. */
  LATEST: 'latest',
} as const;

export type GroupStart = (typeof GROUP_START)[keyof typeof GROUP_START];

export interface DeliverySettings {
  readonly groupStart: GroupStart;
  /** Bir turda okunan (ve takilanlardan alinan) en fazla kayit. */
  readonly batchSize: number;
  /**
   * XREADGROUP'un yeni olay bekleme suresi (ms). Kapanis en fazla bu kadar
   * gecikir: beklenen okuma bitmeden baglanti kapatilmaz.
   */
  readonly blockMs: number;
  /**
   * Onaylanmamis kaydin "takildi" sayilmasi icin gecmesi gereken sure (ms):
   * gecici hatadan sonraki yeniden deneme araligi ve coken tuketicinin
   * kaydini baska tuketicinin devralma suresi. Isleyicinin en uzun
   * suresinden BUYUK olmali; yoksa suren is ikinci kez baslatilir.
   */
  readonly claimIdleMs: number;
  /** Bir olayin isleyiciye en fazla kac kez verilecegi; sonra olu olaylara. */
  readonly maxDeliveries: number;
  /** Tur hatasindan (Redis koptu) sonra yeniden denemeden once bekleme (ms). */
  readonly retryDelayMs: number;
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = Object.freeze({
  groupStart: GROUP_START.BEGINNING,
  batchSize: 50,
  blockMs: 2_000,
  claimIdleMs: 30_000,
  maxDeliveries: 5,
  retryDelayMs: 1_000,
});

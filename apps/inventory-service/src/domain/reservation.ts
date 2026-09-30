/**
 * Rezervasyon alan modeli (T10.1; ADR-01, ADR-03): sepetin TAMAMI tek atomik
 * adimda ayrilir, ya hicbiri. Rezervasyonun kimligi siparisin kimligidir
 * (inventory.proto Reservation.order_id); ayri bir kimlik uretilmez.
 *
 * Burada depo, sorgu ya da protokol yoktur; yalnizca kavramlar ve port.
 */

/** Sepetin bir kalemi: hangi SKU'dan kac adet. */
export interface ReservationLine {
  readonly sku: string;
  /** Tam sayi, 1..99 (sozlesmedeki sepet siniri). */
  readonly quantity: number;
}

export interface ReserveCommand {
  readonly orderId: string;
  readonly marketId: string;
  readonly userId: string;
  /**
   * SKU'lar TEKILDIR (cagiran dogrular): ayni SKU iki kalemde gelse ikisi de
   * ayri ayri yeterli gorunur ve sayac iki kez dusurulurdu (fazla satis).
   */
  readonly lines: readonly ReservationLine[];
  /** Istek ani (ms, servisin saati): bitis = nowMs + ttlMs. */
  readonly nowMs: number;
  readonly ttlMs: number;
}

/**
 * Deponun cevabi. Hata degil SONUC: yetersiz stok ve aktif rezervasyon is
 * akisinin olagan yollaridir; hangisinin hataya donusecegine use-case karar
 * verir. Yazilmayan her durumda depoda HICBIR SEY degismemistir.
 */
export type ReserveOutcome =
  /** Rezerve edildi. */
  | { readonly status: 'reserved'; readonly expiresAt: number }
  /** Bu siparis zaten rezerve; sayaclar TEKRAR dusmedi (ADR-08). */
  | { readonly status: 'already-reserved'; readonly expiresAt: number }
  /** Kullanicinin baska bir siparis icin aktif rezervasyonu var (B22). */
  | { readonly status: 'user-has-active'; readonly activeOrderId: string }
  /**
   * Bir kalem yetmedi (ilk yetmeyen). `counter` sayacin degeridir: negatifse
   * fazla satis izidir. Sayaci hic yoksa `counterMissing` (bekleyen #36): bu
   * markette satilmiyor ya da Redis bosaldi; ikisi de yetersiz sayilir.
   */
  | {
      readonly status: 'insufficient';
      readonly sku: string;
      readonly requested: number;
      readonly counter: number;
      readonly counterMissing: boolean;
    };

/**
 * Rezervasyonun nasil sonuclandigi (T10.2, ADR-18). Bu PR'da yalnizca birakma;
 * onay (PR 2) ve sure dolumu (supurucu, T10.3) buraya eklenir.
 */
export type ReservationSettlement = 'released';

/** Birakma komutu (T10.2). */
export interface ReleaseCommand {
  readonly orderId: string;
  readonly marketId: string;
  /** Kisa anahtar (RELEASE_REASON_PATTERN); defter kaydina oldugu gibi yazilir. */
  readonly reason: string;
  /** Istek ani (ms, servisin saati): sonuclanma ani olarak Redis izine yazilir. */
  readonly nowMs: number;
}

/**
 * Deponun birakma cevabi. Hata degil SONUC (B3, B4): supurucu, kullanici ve
 * odeme ayni rezervasyonu yaris halinde isleyebilir; sahipligi yalnizca biri
 * alir (resv:index'ten ZREM).
 */
export type ReleaseOutcome =
  /**
   * Sahiplik bu cagrinin: sayaclar geri artti. Kaydin izi durur; defter
   * yazilinca silinir (forgetSettled). `skippedCounters`: sayaci olmayan
   * kalem sayisi (sayac YARATILMAZ; bkz. release.lua).
   */
  | {
      readonly status: 'released';
      readonly lines: readonly ReservationLine[];
      readonly skippedCounters: number;
    }
  /**
   * Daha once sonuclanmis, izi hala duruyor: onceki cagrinin defter kaydi
   * yarida kalmis olabilir (ADR-18). Sayaclar TEKRAR hareket etmedi.
   */
  | {
      readonly status: 'settled';
      readonly settlement: ReservationSettlement;
      readonly reason: string;
      readonly settledAt: number;
      readonly lines: readonly ReservationLine[];
    }
  /** Ne aktif rezervasyon ne iz var: hic olmamis ya da coktan sonuclanmis. */
  | { readonly status: 'absent' }
  /**
   * Indekste vardi ama kaydi yoktu (adetler bilinmiyor): indeksten silindi,
   * stok GERI VERILEMEDI. Normal akista olmaz; kayit indeksten once dusmez.
   */
  | { readonly status: 'orphaned' };

/** Rezervasyonun yazilmasi: Redis'te reserve.lua ve release.lua, MOCK'ta bellek. */
export interface ReservationStore {
  reserve(command: ReserveCommand): Promise<ReserveOutcome>;
  release(command: ReleaseCommand): Promise<ReleaseOutcome>;
  /** Defter yazildiktan sonra sonuclanan rezervasyonun izini siler (ADR-18). */
  forgetSettled(marketId: string, orderId: string): Promise<void>;
}

/**
 * Tekrar eden ilk SKU; yoksa undefined. Istek semasi bununla reddeder
 * (VALIDATION_FAILED), depolar ayni kuralla korunur: tekrar depoya ulasirsa
 * cagiranin hatasidir ve fazla satisa donmeden durdurulur.
 */
export function duplicateSku(lines: readonly ReservationLine[]): string | undefined {
  const seen = new Set<string>();
  for (const { sku } of lines) {
    if (seen.has(sku)) {
      return sku;
    }
    seen.add(sku);
  }
  return undefined;
}

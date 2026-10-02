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
 * Rezervasyonun nasil sonuclandigi (ADR-18): birakma ve onay (T10.2) ya da sure
 * dolumu (supurucu, T10.3).
 */
export type ReservationSettlement = 'released' | 'committed' | 'expired';

/** Onay komutu (T10.2 PR 2): odeme onaylandi, ayrilan adet kalici dusecek. */
export interface CommitCommand {
  readonly orderId: string;
  readonly marketId: string;
  /** Istek ani (ms, servisin saati): sonuclanma ani olarak Redis izine yazilir. */
  readonly nowMs: number;
}

/**
 * Sure dolumu komutu (T10.3): supurucu verir. Script, indeks skorunun (bitis
 * ani) hala `nowMs`'ten once oldugunu YENIDEN denetler; uzatilmis rezervasyon
 * (T11.3, ExtendCommand) birakilmaz.
 */
export type ExpireCommand = CommitCommand;

/** Birakma komutu (T10.2). */
export interface ReleaseCommand extends CommitCommand {
  /** Kisa anahtar (RELEASE_REASON_PATTERN); defter kaydina oldugu gibi yazilir. */
  readonly reason: string;
}

/**
 * Daha once sonuclanmis, izi hala duruyor: onceki cagrinin defter kaydi
 * yarida kalmis olabilir (ADR-18). Sayaclar TEKRAR hareket etmedi.
 */
export interface SettledReservation {
  readonly status: 'settled';
  readonly settlement: ReservationSettlement;
  readonly reason: string;
  readonly settledAt: number;
  readonly lines: readonly ReservationLine[];
}

/** Ne aktif rezervasyon ne iz var: hic olmamis ya da coktan sonuclanmis. */
export interface AbsentReservation {
  readonly status: 'absent';
}

/**
 * Indekste vardi ama kaydi yoktu (adetler bilinmiyor): indeksten silindi,
 * stok GERI VERILEMEDI. Normal akista olmaz; kayit indeksten once dusmez.
 */
export interface OrphanedReservation {
  readonly status: 'orphaned';
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
  | SettledReservation
  | AbsentReservation
  | OrphanedReservation;

/**
 * Deponun onay cevabi (T10.2 PR 2). Sayaclara DOKUNULMAZ: adet rezervasyonda
 * zaten dusulmustu; kalici dusum (eldeki adet) Mongo'dadir.
 */
export type CommitOutcome =
  /** Sahiplik bu cagrinin; kaydin izi defter ve eldeki adet yazilinca silinir. */
  | { readonly status: 'committed'; readonly lines: readonly ReservationLine[] }
  | SettledReservation
  | AbsentReservation
  | OrphanedReservation;

/**
 * Deponun sure dolumu cevabi (T10.3). Sahiplik birakmadakiyle ayni (ZREM):
 * supurucu ile onay ayni rezervasyonu yaris halinde isleyebilir (B3).
 */
export type ExpireOutcome =
  /** Sahiplik bu cagrinin: adetler sayaclara dondu; iz defter yazilinca silinir. */
  | {
      readonly status: 'expired';
      readonly lines: readonly ReservationLine[];
      readonly skippedCounters: number;
    }
  /** Bitis ani henuz gelmemis (uzatilmis ya da saat kaymasi): HICBIR SEY yazilmadi. */
  | { readonly status: 'not-due' }
  | SettledReservation
  | AbsentReservation
  | OrphanedReservation;

/**
 * Uzatma komutu (T11.3, B21): odeme ya da 3DS denemesi kilit dusmeden bitsin.
 * Hak sayisini servis verir (RESERVATION_MAX_EXTENSIONS); depo sayaci kayitta
 * tutar ve sinira ulasinca sureye dokunmaz.
 */
export interface ExtendCommand extends CommitCommand {
  readonly additionalMs: number;
  readonly maxExtensions: number;
}

/** Kisaltma komutu (T11.3): kalan sure en cok `maxRemainingMs` olsun. */
export interface ShortenCommand extends CommitCommand {
  readonly maxRemainingMs: number;
}

/**
 * Aktif olmayan rezervasyon (uzatma ve kisaltma icin ayni anlam): kilit dusmus,
 * HICBIR SEY yazilmadi. Sebep gunluk icindir:
 *   settled  - birakilmis, onaylanmis ya da suresi dolup geri alinmis (iz duruyor);
 *   absent   - hic olmamis ya da izi silinmis;
 *   orphaned - indekste var, kaydi yok (birakma ve supurucu temizler);
 *   due      - kayit duruyor ama bitis ani gecmis (supurucu henuz birakmadi);
 *              dusmus kilit uzatilarak diriltilmez.
 */
export interface InactiveReservation {
  readonly status: 'inactive';
  readonly reason: 'settled' | 'absent' | 'orphaned' | 'due';
}

/** Deponun uzatma cevabi. Sinira ulasmak hata degil SONUCTUR (B21). */
export type ExtendOutcome =
  /** Uzatildi; `extensionCount` bu uzatma dahil toplam. */
  | {
      readonly status: 'extended';
      readonly expiresAt: number;
      readonly extensionCount: number;
      readonly lines: readonly ReservationLine[];
    }
  /** Hak bitmisti: sure DEGISMEDI. */
  | {
      readonly status: 'limit-reached';
      readonly expiresAt: number;
      readonly extensionCount: number;
    }
  | InactiveReservation;

/** Deponun kisaltma cevabi. */
export type ShortenOutcome =
  | { readonly status: 'shortened'; readonly expiresAt: number }
  /** Kalan sure zaten sinirin altindaydi: HICBIR SEY yazilmadi. */
  | { readonly status: 'unchanged'; readonly expiresAt: number }
  | InactiveReservation;

/**
 * Rezervasyonun yazilmasi: Redis'te reserve.lua, release.lua, commit.lua,
 * extend.lua ve shorten.lua; MOCK'ta bellek.
 */
export interface ReservationStore {
  reserve(command: ReserveCommand): Promise<ReserveOutcome>;
  release(command: ReleaseCommand): Promise<ReleaseOutcome>;
  commit(command: CommitCommand): Promise<CommitOutcome>;
  /** Bitis anini ileri alir; kayit, indeks ve kullanici kilidi birlikte (T11.3). */
  extend(command: ExtendCommand): Promise<ExtendOutcome>;
  /** Kalan sureyi kisaltir; asla uzatmaz (T11.3). */
  shorten(command: ShortenCommand): Promise<ShortenOutcome>;
  /** Suresi dolani birakir (release.lua'nin sure dolumu kipi, T10.3). */
  expire(command: ExpireCommand): Promise<ExpireOutcome>;
  /**
   * Bitis ani `nowMs`'e kadar gelmis siparisler, en eskisi once, en cok
   * `limit` tane (resv:index ZSET'i, ADR-02).
   */
  listDue(marketId: string, nowMs: number, limit: number): Promise<readonly string[]>;
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

/**
 * Zaman kaynagi soyutlamasi.
 *
 * KURAL: sunucu tarafindaki her sure olcumu (rezervasyon TTL'i, risk motorunun
 * dwell-time hesabi, kurye tick'i, idempotency penceresi) bu arayuz uzerinden
 * okunur; is mantigi icinde Date.now() DOGRUDAN CAGRILMAZ.
 *
 * Neden:
 *  1) Test edilebilirlik - fixedClock ile 600 saniyelik TTL'in dolmasini
 *     beklemeden, saati ileri sararak dogrulayabiliriz.
 *  2) Belirlenebilirlik - demo/seed akislarinda ayni girdi ayni sonucu verir.
 *  3) Tek nokta - ileride saati sunucudan (NTP/Redis TIME) almak gerekirse
 *     sadece bu dosya degisir.
 *
 * Date.now() cagrisi tum kod tabaninda yalnizca asagidaki systemClock icinde bulunur.
 */

/** Okunabilir zaman kaynagi. */
export interface Clock {
  /** Unix epoch'tan beri gecen milisaniye. */
  now(): number;
  /** Ayni ani temsil eden yeni bir Date nesnesi. */
  date(): Date;
}

/** Test icin ileri sarilabilen saat. */
export interface MutableClock extends Clock {
  /** Saati verilen milisaniye kadar ileri alir (negatif deger geri alir). */
  advance(deltaMs: number): void;
  /** Saati verilen epoch degerine sabitler. */
  set(epochMs: number): void;
}

/** Gercek sistem saati - uretimde kullanilan tek uygulama. */
export const systemClock: Clock = {
  now: () => Date.now(),
  date: () => new Date(),
};

/** Sabit (ve istenirse ileri sarilabilen) saat; yalnizca test ve demo icindir. */
export function fixedClock(epochMs: number): MutableClock {
  let current = epochMs;
  return {
    now: () => current,
    // Her cagride yeni Date dondurulur; cagiran mutasyon yaparsa saat bozulmasin.
    date: () => new Date(current),
    advance: (deltaMs) => {
      current += deltaMs;
    },
    set: (nextEpochMs) => {
      current = nextEpochMs;
    },
  };
}

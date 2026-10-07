/**
 * Kurye takibinin zamanlari (F22; T13.3 asama 1, sozlesme tracking.ts).
 * Asama 2'de canli akis sokettir (T13.4); yoklama o zaman kalkar.
 */

/** Pencere acikken: sozlesmenin onerdigi 2 sn (kurye haritada akar). */
export const TRACKING_POLL_OPEN_MS = 2_000;

/**
 * Pencere kapali, kurye yolda: yaklasmayi yakalamak icin 10 sn (PM S1 a;
 * detay yoklamasiyla ayni aralik). Genel hiz sinirinin (dakikada 120) icinde.
 */
export const TRACKING_POLL_WATCH_MS = 10_000;

/** Yaklasma bildirimi bu sure sonra kendiliginden kapanir (kullanici istegi). */
export const APPROACH_NOTICE_MS = 15_000;

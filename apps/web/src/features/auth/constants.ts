/** Kimlik ozelligi sabitleri. */

/**
 * Numara kontrolu (T11.7): numara tamamlandiktan sonra bu kadar beklenir;
 * hizli duzeltmede (son rakami silip yeniden yazma) ara numaralar sorulmaz.
 */
export const PHONE_CHECK_DEBOUNCE_MS = 300;

/** Ayni numaranin cevabi bu sure icinde yeniden sorulmaz (pencereler arasi gecis). */
export const PHONE_CHECK_STALE_TIME_MS = 60 * 1000;

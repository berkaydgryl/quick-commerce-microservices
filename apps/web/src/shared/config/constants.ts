/** Uygulama genelindeki davranis sabitleri (ADR-11). Gorsel degerler tokens.css'tedir. */

/** Gecici hatada (ag, 503) bir sorgunun en fazla kac kez yeniden denenecegi. */
export const MAX_QUERY_RETRIES = 2;

/**
 * Oturum yenileme isteginin sure siniri (T8.5). Yenileme sekmeler arasi kilit
 * altinda calisir; asili bir istek diger sekmeleri en fazla bu kadar bekletir.
 */
export const SESSION_REFRESH_TIMEOUT_MS = 10_000;

/**
 * Yukleniyor gostergesinin titreme korumasi (F18; PM S2 a): bekleyis bu kadar
 * surmezse gosterge hic gorunmez; gorunduyse en az ikinci sure kadar kalir.
 */
export const APP_LOADER_SHOW_AFTER_MS = 300;
export const APP_LOADER_MIN_VISIBLE_MS = 600;

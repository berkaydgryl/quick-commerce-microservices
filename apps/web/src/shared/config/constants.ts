/** Uygulama genelindeki davranis sabitleri (ADR-11). Gorsel degerler tokens.css'tedir. */

/** Gecici hatada (ag, 503) bir sorgunun en fazla kac kez yeniden denenecegi. */
export const MAX_QUERY_RETRIES = 2;

/**
 * Oturum yenileme isteginin sure siniri (T8.5). Yenileme sekmeler arasi kilit
 * altinda calisir; asili bir istek diger sekmeleri en fazla bu kadar bekletir.
 */
export const SESSION_REFRESH_TIMEOUT_MS = 10_000;

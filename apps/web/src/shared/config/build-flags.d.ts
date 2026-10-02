/**
 * Derleme bayraklari (vite.config.ts `define`). Deger derleme aninda sabit
 * olarak yazilir; false dali paketten tamamen atilir.
 */

/** Demo persona secici pakete girsin mi (T8.5): gelistirmede evet, production'da ASLA. */
declare const __DEMO_PERSONAS__: boolean;

/**
 * Kodsuz (demo) sifre yenileme pakete girsin mi (T11.9): gelistirmede evet,
 * production'da ASLA. Kimlik kanitlanmadan sifre degistiren akis canli
 * ortamda yoktur: "Sifremi unuttum" baglantisi ve /sifremi-unuttum sayfasi
 * production paketinde hic gorunmez (gateway ucu da production'da baglanmaz).
 */
declare const __DEMO_PASSWORD_RESET__: boolean;

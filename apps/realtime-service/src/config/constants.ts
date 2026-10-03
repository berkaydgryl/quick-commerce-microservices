/** Realtime servisinin sabitleri (ADR-11). */

export const SERVICE_NAME = 'realtime';

/** Roadmap port haritasindan: realtime 3001 (metrik ucu +1000 = 4001, T10.5 kurali). */
export const DEFAULT_REALTIME_PORT = 3_001;

/**
 * Dinleme adresi. Konteynerde 0.0.0.0 ZORUNLUDUR; 127.0.0.1 yalnizca konteynerin
 * kendisinden erisilebilir olurdu. Ortam degiskeni yok: diger servislerin GRPC_HOST'u
 * gibi bir ihtiyac dogarsa eklenir.
 */
export const DEFAULT_HOST = '0.0.0.0';

/** Socket.io'nun HTTP yolu (kutuphane varsayilani; web'in proxy'si bu yolu yonlendirir). */
export const SOCKET_PATH = '/socket.io';

/** Saglik yolu: Docker HEALTHCHECK ve yerel kontrol (D7). Gateway ile ayni ad. */
export const HEALTH_PATH = '/healthz';

/**
 * Istemciden gelen tek paketin ust siniri (bayt). Istemci yalnizca room.join
 * gonderir (oda adi + ~300 baytlik jeton); 1 MB'lik kutuphane varsayilani,
 * baglanti basina gereksiz bellek ve ayristirma yukudur.
 */
export const MAX_CLIENT_PAYLOAD_BYTES = 4_096;

/**
 * room.join siniri (D8): ayni SOKETTEN pencere basina en fazla bu kadar deneme.
 * Asilirsa RATE_LIMITED. Sinir sokete baglidir ve bellektedir: yeniden baglanan
 * istemcinin sayaci sifirlanir (bilincli; amac kaba kuvvet ve hatali dongu,
 * yeniden baglanmayi cezalandirmak degil).
 */
export const JOIN_RATE_LIMIT = {
  MAX_ATTEMPTS: 10,
  WINDOW_MS: 10_000,
} as const;

/**
 * Jeton suresi icin saat kaymasi payi (sn). Jeton gateway'de imzalanip burada
 * dogrulanir; iki makinenin saati birkac saniye ayrisabilir. 60 sn'lik omrun
 * yaninda kucuk kalir.
 */
export const TOKEN_CLOCK_TOLERANCE_SECONDS = 5;

/** HS256 sirrinin alt siniri (bayt); gateway'deki JWT_SECRET kuraliyla ayni. */
export const MIN_TOKEN_SECRET_BYTES = 32;

/**
 * .env.example'daki ornek sir: production'da REDDEDILIR (gateway de reddeder).
 * Gelistirmede iki taraf ayni ornek degerle calisir.
 */
export const EXAMPLE_TOKEN_SECRET = 'dev-only-insecure-realtime-secret-change-me';

/**
 * Redis adapter'inin pub/sub kanal oneki. Kutuphane varsayilani ("socket.io")
 * yerine servis adi: ayni Redis'i paylasan baska bir Socket.io uygulamasi
 * kanallara karismasin.
 */
export const ADAPTER_CHANNEL_PREFIX = 'realtime';

/** Redis baglanti adlari: CLIENT LIST'te hangi baglantinin ne oldugu okunur. */
export const REDIS_CONNECTION_NAME = {
  PUB: 'realtime-pub',
  SUB: 'realtime-sub',
} as const;

/** Konteyner saglik kontrolunun tek istegi icin ust sinir (ms). */
export const HEALTHCHECK_TIMEOUT_MS = 2_000;

/**
 * Servisler arasinda paylasilan sabitler.
 * Bu dosyada yer alan degerler sozlesmedir: bir servis degistirirse hepsi degisir.
 */

/** Siparis yasam dongusu durumlari. */
export const ORDER_STATUS = {
  DRAFT: 'DRAFT',
  RISK_CHECK: 'RISK_CHECK',
  REVIEW: 'REVIEW',
  RESERVED: 'RESERVED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAID: 'PAID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  PREPARING: 'PREPARING',
  ON_THE_WAY: 'ON_THE_WAY',
  DELIVERED: 'DELIVERED',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * SKU bicim kurali.
 *
 * sku, servisler arasi BIRLESTIRME ANAHTARIDIR: catalog urununu, Redis stok
 * sayacini (stock:{store}:avail:{sku}) ve stock_ledger kaydini ayni degerle
 * baglar. Bu yuzden bicimi tek yerde tanimlanir ve her giris noktasinda
 * (REST, gRPC, seed) ayni desenle dogrulanir.
 *
 * Susleme parantezi, iki nokta ve bosluk BILEREK disaridadir: bunlar Redis
 * anahtarinda ayirici ve hash-tag karakteridir; sku icinde gecerse anahtar
 * duzeni bozulur ve yanlis slot'a duser.
 */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

/** Bir degerin gecerli sku olup olmadigini soyler. */
export function isSku(value: string): boolean {
  return SKU_PATTERN.test(value);
}

/** Olay adlari (event bus konu adlari). */
export const EVENTS = {
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  STOCK_RESERVED: 'stock.reserved',
  STOCK_COMMITTED: 'stock.committed',
  STOCK_RELEASED: 'stock.released',
  STOCK_CHANGED: 'stock.changed',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  COURIER_ASSIGNED: 'courier.assigned',
  COURIER_LOCATION: 'courier.location',
  ORDER_DELIVERED: 'order.delivered',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Risk bantlari; her bant farkli bir akisi tetikler. */
export const RISK_BANDS = {
  /** Normal akis. */
  LOW: 'LOW',
  /** Kisa TTL ile rezervasyon (RESERVATION_TTL_MEDIUM_RISK_SECONDS). */
  MEDIUM: 'MEDIUM',
  /** Manuel inceleme (REVIEW durumu). */
  HIGH: 'HIGH',
  /** Dogrudan ret. */
  CRITICAL: 'CRITICAL',
} as const;

export type RiskBand = (typeof RISK_BANDS)[keyof typeof RISK_BANDS];

/**
 * Redis anahtar ureticileri.
 *
 * HASH-TAG: Redis Cluster slot hesabi ilk `{...}` blogunu kullanir. Bir siparisin
 * rezervasyonu ile o magazanin stok anahtarlari TEK Lua script'inde birlikte
 * degistirildigi icin hepsinin AYNI slotta olmasi gerekir -> hash-tag her zaman
 * magaza kimligidir (stock / resv anahtarlarinda). Kullanici, kurye, idempotency
 * ve rate-limit anahtarlari ise kendi kimlikleriyle etiketlenir.
 */
export const REDIS_KEY = {
  /** Magazanin bir SKU'su icin satilabilir stok sayaci. */
  stockAvail: (storeId: string, sku: string): string => `stock:{${storeId}}:avail:{${sku}}`,
  /** Siparise ait rezervasyon kaydi (hash). */
  reservation: (storeId: string, orderId: string): string => `resv:{${storeId}}:{${orderId}}`,
  /** Magazanin acik rezervasyonlarinin son kullanma indeksi (sorted set). */
  reservationIndex: (storeId: string): string => `resv:index:{${storeId}}`,
  /** Kullanicinin acik rezervasyonlari (ayni anda tek rezervasyon kurali). */
  reservationsByUser: (userId: string): string => `resv:user:{${userId}}`,
  /** Kuryenin rota gecmisi (stream/list). */
  courierTrack: (courierId: string): string => `courier:{${courierId}}:track`,
  /** Kuryenin son bilinen konumu. */
  courierLast: (courierId: string): string => `courier:{${courierId}}:last`,
  /** Idempotency kaydi. */
  idempotency: (key: string): string => `idem:{${key}}`,
  /** IP + rota bazli hiz siniri sayaci. */
  rateLimit: (ip: string, route: string): string => `rate:{${ip}}:{${route}}`,
  /** Tum olaylarin yazildigi tek stream. */
  eventStream: 'stream:events',
  /** Mutabakat (reconcile) isinin dagitik kilidi. */
  reconcileLock: 'lock:reconcile',
} as const;

/**
 * Anahtarin slot hesabinda kullanilacak hash-tag'ini dondurur.
 * Tag yoksa (veya bos ise) undefined doner - o anahtar kendi adina gore dagitilir.
 */
export function redisHashTag(key: string): string | undefined {
  const start = key.indexOf('{');
  if (start < 0) {
    return undefined;
  }
  const end = key.indexOf('}', start + 1);
  if (end < 0 || end === start + 1) {
    return undefined;
  }
  return key.slice(start + 1, end);
}

/**
 * Mock odeme saglayicisinin kabul ettigi 3DS kodu (payment.proto: "mock
 * saglayicida sabit bir kod beklenir; deger packages/core icindeki
 * sabitlerden gelir"). Bicim sozlesmedeki OTP kuraliyla ayni: 6 hane.
 * Yalnizca demo ve testler icindir; gercek saglayicida kodu banka uretir.
 */
export const MOCK_THREEDS_CODE = '123456';

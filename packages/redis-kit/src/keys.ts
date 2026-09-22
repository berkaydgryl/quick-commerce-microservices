/**
 * Redis anahtar ureticileri.
 *
 * TEK KAYNAK: bir anahtarin bicimi baska hicbir yerde elle yazilmaz. Anahtari
 * yazan (inventory), okuyan (gateway) ve supuren (sweeper) taraf ayni
 * fonksiyonu cagirir; boylece bicim degisirse tek dosya degisir.
 *
 * HASH-TAG KURALI
 * Redis Cluster, anahtari slot'a ATARKEN yalnizca ilk suslu parantez cifti
 * arasindaki metni dikkate alir. Bir depoya ait tum anahtarlar
 * stock:{ds_kadikoy}:avail:SUT-1L, resv:{ds_kadikoy}:ord_1, resv:index:{ds_kadikoy}
 * biciminde yazildigi icin ayni slot'a duser ve rezervasyon Lua script'i tek
 * dugumde, tek atomik adimda calisabilir (ADR-01).
 *
 * Tablodaki {sku}, {orderId} gibi gosterimler YER TUTUCUDUR; gercek anahtarda
 * suslu parantez YALNIZCA hash-tag olan parcada bulunur.
 */

import { AppError, isSku } from '@getir/core';

/** Anahtar parcalarinda izin verilen karakterler: ':' ve '{}' ayirici oldugu icin yasak. */
const COMPONENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Idempotency anahtari istemciden gelir; UUID ve benzeri biraz daha uzun olabilir. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** IPv4 ve IPv6 birlikte: IPv6 iki nokta icerir, bu yuzden ayri desen. */
const IP_PATTERN = /^[0-9a-fA-F.:]{3,45}$/;

/** Oran sinirlama yolu: "POST_/v1/orders" gibi; bosluk ve iki nokta yok. */
const ROUTE_PATTERN = /^[A-Za-z0-9_/.-]{1,128}$/;

/** Olay akisi tek anahtardir; depoya gore bolunmez (outbox ciktisi). */
export const EVENTS_STREAM_KEY = 'stream:events';

/** Supurucu/reconcile liderligi (ADR-01: Redlock yalnizca burada). */
export const RECONCILE_LOCK_KEY = 'lock:reconcile';

/** Bir degeri hash-tag haline getirir: ds_1 -> {ds_1} */
export function hashTag(value: string): string {
  return `{${value}}`;
}

/**
 * Anahtarin hash-tag'ini dondurur; yoksa undefined.
 * Redis'in kuralinin aynisi: ILK '{' ile ONDAN SONRAKI ilk '}' arasi, ve
 * aralari bos degilse.
 */
export function hashTagOf(key: string): string | undefined {
  const start = key.indexOf('{');
  if (start === -1) {
    return undefined;
  }
  const end = key.indexOf('}', start + 1);
  if (end === -1 || end === start + 1) {
    return undefined;
  }
  return key.slice(start + 1, end);
}

/**
 * Verilen anahtarlarin tamami ayni slot'a duser mi?
 *
 * Tek dugumlu Redis bunu UMURSAMAZ; kural yalnizca Cluster'da baglayicidir.
 * Bu yuzden burasi bir kapi degil, bir SORU: script yukleyici cevabi hayirsa
 * uyari gunlugu yazar, calismayi engellemez.
 */
export function sameHashTag(keys: readonly string[]): boolean {
  if (keys.length < 2) {
    return true;
  }
  const first = hashTagOf(keys[0] ?? '');
  return keys.every((key) => hashTagOf(key) === first);
}

/** Anahtar parcasini dogrular; gecersizse AppError firlatir. */
function requireComponent(name: string, value: string, pattern = COMPONENT_PATTERN): string {
  if (!pattern.test(value)) {
    throw AppError.validation(`Gecersiz Redis anahtar parcasi: ${name}`, {
      details: { field: name, value },
    });
  }
  return value;
}

/** stock:{store}:avail:SUT-1L -- satilabilir adet (string, tam sayi). */
export function stockAvailKey(storeId: string, sku: string): string {
  requireComponent('storeId', storeId);
  if (!isSku(sku)) {
    // SKU bicimi @getir/core icindeki SKU_PATTERN ile tanimlidir: Redis
    // anahtarinda gectigi icin bosluk, iki nokta ve susleme karakteri iceremez.
    throw AppError.validation('Gecersiz sku', { details: { field: 'sku', value: sku } });
  }
  return `stock:${hashTag(storeId)}:avail:${sku}`;
}

/** resv:{store}:ord_1 -- rezervasyon hash'i (qty:{sku}, orderId, expiresAt...). */
export function reservationKey(storeId: string, orderId: string): string {
  requireComponent('storeId', storeId);
  requireComponent('orderId', orderId);
  return `resv:${hashTag(storeId)}:${orderId}`;
}

/** resv:index:{store} -- suresi dolani bulmak icin ZSET (skor = expiresAt ms). */
export function reservationIndexKey(storeId: string): string {
  requireComponent('storeId', storeId);
  return `resv:index:${hashTag(storeId)}`;
}

/**
 * resv:user:{userId} -- kullanicinin aktif rezervasyonu (ikinciyi engeller, B22).
 *
 * DIKKAT (bilinen sinir): reserve.lua bu anahtara da dokunur ama hash-tag'i
 * userId'dir, stok anahtarlarininki storeId. Tek dugumlu Redis'te sorun degil;
 * Cluster'a gecilirse ayni script iki ayri slot'a dokunur ve CROSSSLOT hatasi
 * alir. O gun icin secenek, kullanici anahtarini da store hash-tag'i altina
 * almak (resv:{store}:user:{userId}) - ama o zaman ayni kullanicinin FARKLI
 * depolardaki ikinci rezervasyonu engellenemez. Karar, Cluster gercekten
 * gerektiginde verilecek; bugun tek dugum kullaniliyor.
 */
export function userReservationKey(userId: string): string {
  requireComponent('userId', userId);
  return `resv:user:${hashTag(userId)}`;
}

/** courier:{courierId}:track -- son 30 GPS noktasi (LTRIM ile kirpilir). */
export function courierTrackKey(courierId: string): string {
  requireComponent('courierId', courierId);
  return `courier:${hashTag(courierId)}:track`;
}

/** courier:{courierId}:last -- son bilinen konum (JSON). */
export function courierLastKey(courierId: string): string {
  requireComponent('courierId', courierId);
  return `courier:${hashTag(courierId)}:last`;
}

/** idem:{key} -- islenmis istek cevabi ya da "in-progress" isareti (ADR-08). */
export function idempotencyKey(key: string): string {
  requireComponent('idempotencyKey', key, IDEMPOTENCY_KEY_PATTERN);
  return `idem:${hashTag(key)}`;
}

/** rate:{ip}:POST_/v1/orders -- kayan pencere sayaci. */
export function rateLimitKey(ip: string, route: string): string {
  requireComponent('ip', ip, IP_PATTERN);
  requireComponent('route', route, ROUTE_PATTERN);
  return `rate:${hashTag(ip)}:${route}`;
}

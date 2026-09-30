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

import {
  AppError,
  ID_PREFIX,
  IDEMPOTENCY_KEY_CHARSET,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  isId,
  isSku,
} from '@getir/core';

/** Anahtar parcalarinda izin verilen karakterler: ':' ve '{}' ayirici oldugu icin yasak. */
const COMPONENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Idempotency anahtari istemciden gelir; UUID ve benzeri biraz daha uzun olabilir.
 * Uzunluk sinirlari REST sozlesmesiyle ayni kaynaktan gelir (@getir/core): burada
 * sayi yazilirsa sozlesme degistiginde Redis tarafi sessizce geride kalir.
 */
const IDEMPOTENCY_KEY_PATTERN = new RegExp(
  `^[${IDEMPOTENCY_KEY_CHARSET}]{${IDEMPOTENCY_KEY_MIN_LENGTH},${IDEMPOTENCY_KEY_MAX_LENGTH}}$`,
);

/** IPv4 ve IPv6 birlikte: IPv6 iki nokta icerir, bu yuzden ayri desen. */
const IP_PATTERN = /^[0-9a-fA-F.:]{3,45}$/;

/** Oran sinirlama yolu: "POST_/v1/orders" gibi; bosluk ve iki nokta yok. */
const ROUTE_PATTERN = /^[A-Za-z0-9_/.-]{1,128}$/;

/** Olay akisi tek anahtardir; depoya gore bolunmez (outbox ciktisi). */
export const EVENTS_STREAM_KEY = 'stream:events';

/**
 * Islenemeyen olaylar (T7.4): tuketici grubunun kalici olarak isleyemedigi ya
 * da deneme hakki biten olay, gerekcesiyle buraya tasinir. Tum gruplar ayni
 * akisa yazar; kaydin `dead.group` alani hangi grubun biraktigini soyler.
 * TTL yerine uzunlukla sinirlidir (ADR-16).
 */
export const EVENTS_DEAD_LETTER_STREAM_KEY = 'stream:events:dead';

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
 * depolardaki ikinci rezervasyonu engellenemez. 30 Eylul (T10.1) karari:
 * kullanici basina TEK anahtar; reserve script'i bunu loadLuaScripts'e
 * `crossSlot` olarak beyan eder (cagri basina uyari yazilmaz). Cluster'a
 * gecilirse karar yeniden verilir; bugun tek dugum kullaniliyor.
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

/**
 * Kimligi dogrulanmamis istegin idempotency kapsami (kayit ucu): anahtar tum
 * anonim isteklerde ortaktir, farkli govdeyle gelen ayni anahtari istek parmak
 * izi ayirir (ADR-08 eki, T8.2).
 */
export const IDEMPOTENCY_ANONYMOUS_SCOPE = 'anon';

/**
 * idem:{scope}:key -- islenmis istek cevabi ya da "in-progress" isareti (ADR-08).
 *
 * KAPSAM (T8.2): anahtar kullanici basinadir (scope = usr_...). Iki kullanici
 * ayni anahtari secse bile kayitlari ayrisir; biri digerinin cevabini tekrar
 * olarak alamaz. Kimliksiz uclarda kapsam IDEMPOTENCY_ANONYMOUS_SCOPE'tur.
 * Yazan tek taraf gateway'dir (Go); bicim burada tanimli, gateway'in testi
 * bu satiri okuyup karsilastirir.
 */
export function idempotencyKey(scope: string, key: string): string {
  requireComponent('scope', scope);
  requireComponent('idempotencyKey', key, IDEMPOTENCY_KEY_PATTERN);
  return `idem:${hashTag(scope)}:${key}`;
}

/**
 * rate:{ozne}:POST_/v1/orders -- kayan pencere sayaci (T8.2, roadmap P2).
 *
 * OZNE: kimliksiz uclarda istemcinin IP'si, kimlikli uclarda kullanici
 * (usr_...). Ayni agin (ofis, mobil operator) arkasindaki kullanicilar
 * birbirinin sinirini tuketmez; hesap acma zaten IP basina sinirlidir.
 * Yol parametresi ':' olmadan yazilir (POST_/v1/orders/id/3ds): ':' anahtar
 * ayiricisidir. Yazan tek taraf gateway'dir (Go); bicim burada tanimli,
 * gateway'in testi bu satiri okuyup karsilastirir.
 */
export function rateLimitKey(subject: string, route: string): string {
  if (!IP_PATTERN.test(subject) && !isId(ID_PREFIX.USER, subject)) {
    throw AppError.validation('Gecersiz Redis anahtar parcasi: subject', {
      details: { field: 'subject', value: subject },
    });
  }
  requireComponent('route', route, ROUTE_PATTERN);
  return `rate:${hashTag(subject)}:${route}`;
}

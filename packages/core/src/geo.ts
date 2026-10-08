/**
 * Kure uzerinde mesafe ve teslimat yaricapi kurali (saf). Teslimat yaricapini
 * denetleyen her servis BU fonksiyonlari kullanir (catalog kapsamasi ilk
 * kullanicidir): mesafe ve esitsizlik tek yerde.
 *
 * Mongo uretimde mesafeyi $geoNear ile kendisi hesaplar ve yaricapi $lte ile
 * suzer; bu fonksiyonlar onunla ayni sonucu verir. Catalog sozlesme testi
 * (apps/catalog-service/test/support/market-reader-contract.ts) iki modu
 * karsilastirir: +-1 m (216 m'de olculur). Yaricap sinirinda bu fark nadiren
 * farkli karar verebilir.
 */

/** WGS84 koordinati. */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Dunya yaricapi (metre): MongoDB'nin 2dsphere mesafe hesabinda kullandigi
 * EKVATOR yaricapi, 6378,1 km.
 *
 * NEDEN BU DEGER, ortalama yaricap (6371,0 km) DEGIL: bellek uygulamasi (MOCK)
 * ile Mongo ayni mesafeyi vermeli. Ilk surum ortalama yaricapla yazildi;
 * sozlesme testi 71 km'de 79 m fark OLCTU (oran 1,00111 = 6378,1 / 6371,0).
 * Kisa mesafede fark metrenin altinda kaliyordu, uzun mesafede
 * "en yakin depo X km" bilgisini iki modda farkli gosterirdi.
 */
const EARTH_RADIUS_METERS = 6_378_100;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Iki nokta arasindaki buyuk daire mesafesi (haversine), metre. */
export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Konum marketin teslimat yaricapi DISINDA mi? Sinir DAHILDIR: mesafe == yaricap
 * hizmet verir (disarida degil). Catalog'un ilk yazimiyla birebir (`>`): NaN
 * mesafe ya da yaricap "disarida" SAYILMAZ; cagiran veriyi kendisi dogrular.
 */
export function isOutsideDeliveryRadius(distance: number, radiusMeters: number): boolean {
  return distance > radiusMeters;
}

/**
 * Kure uzerinde mesafe (saf).
 *
 * Bellek uygulamasi (MOCK) icin: Mongo mesafeyi $geoNear ile kendisi hesaplar.
 * Iki uygulamanin ayni sonucu verdigi sozlesme testinde OLCULUR
 * (test/support/dark-store-reader-contract.ts), +-1 m.
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

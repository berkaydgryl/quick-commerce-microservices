/**
 * Baglanti adresindeki kimlik bilgisini gunluk icin gizler.
 *
 * NEDEN BURADA: Mongo ve Redis istemcileri ayni isi yapiyordu ve ikisi de
 * kendi kopyasini tasiyordu (mongo-kit redactUri, redis-kit redactUrl -
 * regex'e kadar ayni). Kopyalardan biri duzeltilip digeri unutulursa parola
 * gunluge sizar. Paket kurali da ayni yone isaret ediyor: baglanti dosyasi
 * baglanti kurar, maskeleme yapmaz.
 */

/** "//kullanici:parola@" bolumunu "//***@" yapar; kimlik yoksa adres oldugu gibi kalir. */
export function redactConnectionString(uri: string): string {
  return uri.replace(/\/\/([^@/]*)@/, '//***@');
}

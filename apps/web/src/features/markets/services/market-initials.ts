/**
 * Logonun yerine bas harf rozeti (T11.11 karari: marka logosu kullanilmaz).
 * Markanin ilk iki kelimesinin bas harfi, Turkce buyuk harf:
 * "Migros Jet" -> "MJ", "ŞOK" -> "Ş", "A101" -> "A".
 */
export function marketInitials(brand: string): string {
  return brand
    .split(/[\s–-]+/u)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toLocaleUpperCase('tr');
}

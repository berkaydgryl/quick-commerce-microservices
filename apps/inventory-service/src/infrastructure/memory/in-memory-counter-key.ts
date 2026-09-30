/**
 * Bellekteki sayac haritasinin anahtari. Sayaclar ve rezervasyonlar AYNI
 * haritayi kullanir (Redis'te ayni stock:{market}:avail:{sku} anahtarlarina
 * dokunmalari gibi): rezervasyonun dusumu musaitlik sorgusunda gorunur.
 */
export function counterKey(marketId: string, sku: string): string {
  return `${marketId}/${sku}`;
}

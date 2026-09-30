import type { SearchResult } from '@getir/contracts';

/**
 * Kartta gosterilmeyen eslesen urun sayisi ("+N urun daha"): toplamdan
 * gosterilenler cikar. Sunucu market basina en fazla 3 urun gonderir; toplam
 * her zaman en az gosterilen kadardir, yine de sonuc negatif olmaz.
 */
export function hiddenProductCount(result: SearchResult): number {
  return Math.max(0, result.totalProductMatches - result.products.length);
}

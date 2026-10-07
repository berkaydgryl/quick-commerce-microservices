/**
 * "Son N adet" rozeti (T16.3; T7.6'dan tasindi; PM karari L4): stok bu sayi
 * ve altindaysa rozet gorunur. Bilgi amaclidir; baglayici kontrol
 * rezervasyondadir (ADR-13).
 */
export const LOW_STOCK_BADGE_MAX = 5;

/**
 * Rozetin sayisi: stok biliniyor, sifirdan buyuk ve esigin altindaysa stok,
 * degilse undefined (rozet yok). Stok bilgisi yoksa rozet de yoktur (T8.4:
 * alanin yoklugu "stok 0" demek degil); 0 "Tükendi"dir, rozet degil.
 */
export function lowStockCount(stock: number | undefined): number | undefined {
  return stock !== undefined && stock > 0 && stock <= LOW_STOCK_BADGE_MAX ? stock : undefined;
}

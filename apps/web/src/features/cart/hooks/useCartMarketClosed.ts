import { useMarket } from '../../markets/hooks/useMarket';
import { isMarketClosed } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

/**
 * Sepetin marketi KAPALI mi (07.10 kullanici istegi): "+" pasif, /sepet'te
 * "Ödemeye Geç" pasif, panelde not. Bilgi sepetin marketinin sorgusundan
 * (useCartTotals ile ayni anahtar; ek istek yok). Henuz bilinmiyorsa false:
 * yukleme sirasinda "Ödemeye Geç" zaten pasif (toplam yok), /odeme de
 * kapaliyi ayrica durdurur (orderBlocker 'closed').
 */
export function useCartMarketClosed(): boolean {
  const marketId = useCartStore((cart) => cart.market?.id);
  return isMarketClosed(useMarket(marketId).data);
}

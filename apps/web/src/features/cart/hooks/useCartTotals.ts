import type { CartTotals } from '@getir/pricing';
import { useMemo } from 'react';

import { useMarket } from '../../markets/hooks/useMarket';
import { calculateCartTotals } from '../services/cart.service';
import { useCartStore } from '../stores/useCartStore';

/**
 * Sepet toplami, SEPETIN MARKETININ kurallariyla. Sepetin marketi gezilen
 * marketten farkli olabilir (A101'e bakarken sepet Migros'ta); kurallar her
 * zaman sepetin marketinden okunur. Market bilgisi ayni sorgu anahtariyla
 * onbellekten gelir, ek istek yoktur.
 *
 * Sepet bossa ya da kurallar henuz gelmediyse undefined doner.
 */
export function useCartTotals(): CartTotals | undefined {
  const items = useCartStore((cart) => cart.items);
  const marketId = useCartStore((cart) => cart.market?.id);
  const rules = useMarket(marketId).data?.pricingRules;

  return useMemo(
    () =>
      rules === undefined || items.length === 0 ? undefined : calculateCartTotals(items, rules),
    [items, rules],
  );
}

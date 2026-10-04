import type { MarketListCartContent } from '@getir/contracts';

import { useCartTotals } from '../hooks/useCartTotals';
import { useCartStore } from '../stores/useCartStore';

import { CartPanelView } from './CartPanelView';

interface CartPanelProps {
  readonly texts: MarketListCartContent;
  /** Sepetin marketinin sayfasi (sayfa verir: sepet market adreslerini tanimaz). */
  readonly cartHref: (marketId: string) => string;
}

/** Sepetim paneli (T11.12): sepet deposu (Zustand) ve toplamla gorunumu besler. */
export function CartPanel({ texts, cartHref }: CartPanelProps) {
  const market = useCartStore((cart) => cart.market);
  const items = useCartStore((cart) => cart.items);
  const clear = useCartStore((cart) => cart.clear);
  const totals = useCartTotals();

  return (
    <CartPanelView
      texts={texts}
      market={market}
      items={items}
      totals={totals}
      cartHref={market === null ? undefined : cartHref(market.id)}
      onClear={clear}
    />
  );
}

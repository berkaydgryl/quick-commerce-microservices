import type { MarketListCartContent } from '@getir/contracts';
import { useState } from 'react';

import { useCartTotals } from '../hooks/useCartTotals';
import { canIncrement } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

import { CartPanelView } from './CartPanelView';
import { ClearCartDialog } from './ClearCartDialog';

interface CartPanelProps {
  readonly texts: MarketListCartContent;
  /** Bir marketin sayfasi (sayfa verir: sepet market adreslerini tanimaz). */
  readonly marketHref: (marketId: string) => string;
  /** "Sepete git"in hedefi (sepetin marketiyle). */
  readonly cartHref: (marketId: string) => string;
  /** "Sepetim" basligi gorunur mu. */
  readonly titleVisible?: boolean | undefined;
}

/**
 * Sepetim paneli (T11.12; T16.3'te referans duzeni): sepet deposu (Zustand) ve
 * toplamla gorunumu besler; bosaltma onayinin acik olup olmadigini tutar.
 */
export function CartPanel({ texts, marketHref, cartHref, titleVisible }: CartPanelProps) {
  const market = useCartStore((cart) => cart.market);
  const items = useCartStore((cart) => cart.items);
  const increment = useCartStore((cart) => cart.increment);
  const decrement = useCartStore((cart) => cart.decrement);
  const remove = useCartStore((cart) => cart.remove);
  const clear = useCartStore((cart) => cart.clear);
  const totals = useCartTotals();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <CartPanelView
        texts={texts}
        market={market}
        items={items}
        totals={totals}
        marketHref={market === null ? undefined : marketHref(market.id)}
        cartHref={market === null ? undefined : cartHref(market.id)}
        titleVisible={titleVisible}
        canIncrement={(offerId) => canIncrement({ market, items }, offerId)}
        onIncrement={increment}
        onDecrement={decrement}
        onRemove={remove}
        onAskClear={() => setConfirming(true)}
      />
      {confirming && (
        <ClearCartDialog
          texts={texts}
          onConfirm={() => {
            clear();
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

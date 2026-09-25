import type { Product } from '@getir/contracts';
import { useState } from 'react';

import type { CartMarket } from '../services/cart-state';
import { useCartStore } from '../stores/useCartStore';

/** Onay bekleyen market degisimi: hangi urun, hangi marketten, sepet hangi markette. */
export interface PendingSwitch {
  readonly product: Product;
  readonly currentMarket: CartMarket;
}

/**
 * Bu marketten sepete ekleme. Sepet baska marketinse ekleme yapilmaz; bekleyen
 * degisim doner ve arayuz kullaniciya sorar (nasil soracagi arayuzun kararidir:
 * satir, modal, cekmece...). Bekleyen degisim yerel UI durumudur (useState).
 */
export function useAddToCart(market: CartMarket | undefined) {
  const add = useCartStore((cart) => cart.add);
  const startNewCart = useCartStore((cart) => cart.startNewCart);
  const [pending, setPending] = useState<PendingSwitch | undefined>(undefined);

  return {
    pending,
    add: (product: Product): void => {
      if (market === undefined) return;
      const outcome = add(product, market);
      if (outcome.status === 'needs-confirmation') {
        setPending({ product, currentMarket: outcome.currentMarket });
      }
    },
    confirmSwitch: (): void => {
      if (pending !== undefined && market !== undefined) {
        startNewCart(pending.product, market);
      }
      setPending(undefined);
    },
    cancelSwitch: (): void => setPending(undefined),
  };
}

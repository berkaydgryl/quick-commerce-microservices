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
 * Onaylanan market degisiminin hedefi: bekleyen urun ve market var, market ACIK
 * (07.10). Pencere acikken market kapanirsa (sorgu yenilenir) onay sepeti
 * degistirmez: undefined.
 */
export function switchTarget(
  pending: PendingSwitch | undefined,
  market: CartMarket | undefined,
  closed: boolean,
): { readonly product: Product; readonly market: CartMarket } | undefined {
  return pending === undefined || market === undefined || closed
    ? undefined
    : { product: pending.product, market };
}

/**
 * Bu marketten sepete ekleme. Sepet baska marketinse ekleme yapilmaz; bekleyen
 * degisim doner ve arayuz kullaniciya sorar (nasil soracagi arayuzun kararidir:
 * satir, modal, cekmece...). Bekleyen degisim yerel UI durumudur (useState).
 * Market kapaliysa (07.10) ekleme yok sayilir: pasif "+"yi atlatan cagriya
 * karsi ikinci kat (sepet ve market degistirme penceresi degismez).
 */
export function useAddToCart(market: CartMarket | undefined, closed = false) {
  const add = useCartStore((cart) => cart.add);
  const startNewCart = useCartStore((cart) => cart.startNewCart);
  const [pending, setPending] = useState<PendingSwitch | undefined>(undefined);

  return {
    pending,
    add: (product: Product): void => {
      if (market === undefined || closed) return;
      const outcome = add(product, market);
      if (outcome.status === 'needs-confirmation') {
        setPending({ product, currentMarket: outcome.currentMarket });
      }
    },
    confirmSwitch: (): void => {
      const target = switchTarget(pending, market, closed);
      if (target !== undefined) {
        startNewCart(target.product, target.market);
      }
      setPending(undefined);
    },
    cancelSwitch: (): void => setPending(undefined),
  };
}

/**
 * Zustand store'u saf kurallari dogru bagliyor mu: onay isteyen ekleme sepeti
 * degistirmez, onaylanan degisim yeni marketle baslar, temizleme bosaltir.
 */

import type { Product } from '@getir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_CART } from '../../src/features/cart/services/cart-state';
import { useCartStore } from '../../src/features/cart/stores/useCartStore';

const MIGROS = { id: 'mkt_migros-jet-moda', name: 'Migros Jet – Moda' };
const A101 = { id: 'mkt_a101-caferaga', name: 'A101 – Caferağa' };

const sut = (marketId: string, priceMinor: number): Product => ({
  id: 'prd_sut-1l',
  offerId: `ofr_${marketId}-sut`,
  marketId,
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  categoryId: 'cat_sut-kahvaltilik',
  price: { amountMinor: priceMinor, currency: 'TRY' },
});

beforeEach(() => {
  useCartStore.setState(EMPTY_CART);
});

describe('useCartStore', () => {
  it('ekleme sonucu doner ve durumu gunceller', () => {
    const outcome = useCartStore.getState().add(sut(MIGROS.id, 3490), MIGROS);

    expect(outcome).toEqual({ status: 'added' });
    expect(useCartStore.getState()).toMatchObject({ market: MIGROS, items: [{ quantity: 1 }] });
  });

  it('baska marketten ekleme onay ister ve sepeti DEGISTIRMEZ', () => {
    const { add } = useCartStore.getState();
    add(sut(MIGROS.id, 3490), MIGROS);

    const outcome = add(sut(A101.id, 3210), A101);

    expect(outcome).toEqual({ status: 'needs-confirmation', currentMarket: MIGROS });
    expect(useCartStore.getState().market).toEqual(MIGROS);
  });

  it('onaylanan degisim: eski sepet gider, A101 fiyatiyla yeni sepet', () => {
    const { add, startNewCart } = useCartStore.getState();
    add(sut(MIGROS.id, 3490), MIGROS);

    startNewCart(sut(A101.id, 3210), A101);

    expect(useCartStore.getState()).toMatchObject({
      market: A101,
      items: [{ unitPriceMinor: 3210, quantity: 1 }],
    });
  });

  it('azaltma ve temizleme', () => {
    const { add, decrement, clear } = useCartStore.getState();
    add(sut(MIGROS.id, 3490), MIGROS);
    add(sut(MIGROS.id, 3490), MIGROS);

    decrement(`ofr_${MIGROS.id}-sut`);
    expect(useCartStore.getState().items[0]?.quantity).toBe(1);

    clear();
    expect(useCartStore.getState()).toMatchObject(EMPTY_CART);
  });
});

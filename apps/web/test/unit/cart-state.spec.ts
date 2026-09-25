/**
 * Sepetin saf kurallari: tek market ve onay, adet ve kalem sinirlari, azaltma.
 * Arayuzden bagimsiz: tasarim bastan degisse de bu testler gecerli kalir.
 */

import { CART_ITEM_MAX_QUANTITY, CART_MAX_ITEMS } from '@getir/contracts';
import type { Product } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  addItem,
  decrementItem,
  EMPTY_CART,
  itemCount,
  quantityOf,
  removeItem,
  startNewCart,
} from '../../src/features/cart/services/cart-state';
import type { CartState } from '../../src/features/cart/services/cart-state';

const MIGROS = { id: 'mkt_migros-jet-moda', name: 'Migros Jet – Moda' };
const A101 = { id: 'mkt_a101-caferaga', name: 'A101 – Caferağa' };

const product = (slug: string, priceMinor = 3490, marketId = MIGROS.id): Product => ({
  id: `prd_${slug}`,
  offerId: `ofr_${marketId.slice(4)}-${slug}`,
  marketId,
  sku: slug.toUpperCase(),
  name: slug,
  categoryId: 'cat_sut-kahvaltilik',
  price: { amountMinor: priceMinor, currency: 'TRY' },
});

const SUT = product('sut-1l');
const EKMEK = product('ekmek', 1250);

const addMany = (state: CartState, item: Product, times: number): CartState => {
  let current = state;
  for (let i = 0; i < times; i += 1) current = addItem(current, item, MIGROS).state;
  return current;
};

describe('tek market kurali', () => {
  it('bos sepete ekleme marketi belirler', () => {
    const { state, outcome } = addItem(EMPTY_CART, SUT, MIGROS);

    expect(outcome).toEqual({ status: 'added' });
    expect(state.market).toEqual(MIGROS);
    expect(quantityOf(state, SUT.offerId)).toBe(1);
  });

  it('baska marketten ekleme YAPILMAZ, onay istenir; sepet degismez', () => {
    const migrosCart = addItem(EMPTY_CART, SUT, MIGROS).state;

    const { state, outcome } = addItem(migrosCart, product('sut-1l', 3210, A101.id), A101);

    expect(outcome).toEqual({ status: 'needs-confirmation', currentMarket: MIGROS });
    expect(state).toBe(migrosCart);
  });

  it('onaylanan degisim eski sepeti bosaltir, yeni marketle baslar', () => {
    const a101Sut = product('sut-1l', 3210, A101.id);

    const state = startNewCart(a101Sut, A101);

    expect(state.market).toEqual(A101);
    expect(state.items).toEqual([
      expect.objectContaining({ offerId: a101Sut.offerId, unitPriceMinor: 3210 }),
    ]);
  });

  it('sepet bosalinca baska marketten onaysiz eklenir', () => {
    const emptied = removeItem(addItem(EMPTY_CART, SUT, MIGROS).state, SUT.offerId);

    expect(addItem(emptied, product('elma', 1990, A101.id), A101).outcome).toEqual({
      status: 'added',
    });
  });
});

describe('kalem kimligi: teklif (offerId), urun degil', () => {
  it('baska marketin AYNI urunu sepette sayilmaz (T6.4 canli denemede bulunan hata)', () => {
    const migrosCart = addMany(EMPTY_CART, SUT, 2);
    const a101Sut = product('sut-1l', 3210, A101.id);

    expect(a101Sut.id).toBe(SUT.id);
    expect(quantityOf(migrosCart, a101Sut.offerId)).toBe(0);
    expect(quantityOf(migrosCart, SUT.offerId)).toBe(2);
  });

  it('baska marketin teklifini azaltmak sepetteki kalemi ETKILEMEZ', () => {
    const migrosCart = addMany(EMPTY_CART, SUT, 2);
    const a101Sut = product('sut-1l', 3210, A101.id);

    expect(decrementItem(migrosCart, a101Sut.offerId)).toBe(migrosCart);
  });
});

describe('adet ve fiyat', () => {
  it('ayni urun ikinci kez eklenince adet artar, kalem cogalmaz', () => {
    const state = addMany(EMPTY_CART, SUT, 3);

    expect(state.items).toHaveLength(1);
    expect(quantityOf(state, SUT.offerId)).toBe(3);
    expect(itemCount(addItem(state, EKMEK, MIGROS).state)).toBe(4);
  });

  it('eklendigi andaki teklif fiyati saklanir (kurus)', () => {
    expect(addItem(EMPTY_CART, SUT, MIGROS).state.items[0]).toMatchObject({
      productId: SUT.id,
      offerId: SUT.offerId,
      unitPriceMinor: 3490,
    });
  });

  it('azaltma son adette kalemi, son kalemde sepeti bosaltir', () => {
    const two = addMany(EMPTY_CART, SUT, 2);

    const one = decrementItem(two, SUT.offerId);
    expect(quantityOf(one, SUT.offerId)).toBe(1);
    expect(decrementItem(one, SUT.offerId)).toEqual(EMPTY_CART);
  });

  it('sepette olmayan urunu azaltmak sepeti degistirmez', () => {
    const state = addItem(EMPTY_CART, SUT, MIGROS).state;
    expect(decrementItem(state, EKMEK.offerId)).toBe(state);
  });
});

describe('sinirlar (rezervasyon semasiyla ayni)', () => {
  it(`urun basina en fazla ${CART_ITEM_MAX_QUANTITY} adet`, () => {
    const full = addMany(EMPTY_CART, SUT, CART_ITEM_MAX_QUANTITY);

    const { state, outcome } = addItem(full, SUT, MIGROS);

    expect(outcome).toEqual({ status: 'limit-reached', limit: 'quantity' });
    expect(quantityOf(state, SUT.offerId)).toBe(CART_ITEM_MAX_QUANTITY);
  });

  it(`sepette en fazla ${CART_MAX_ITEMS} farkli urun`, () => {
    let state: CartState = EMPTY_CART;
    for (let i = 0; i < CART_MAX_ITEMS; i += 1)
      state = addItem(state, product(`urun${i}`), MIGROS).state;

    const { outcome } = addItem(state, product('fazla'), MIGROS);

    expect(outcome).toEqual({ status: 'limit-reached', limit: 'items' });
    expect(state.items).toHaveLength(CART_MAX_ITEMS);
  });
});

/**
 * Sepetin saf kurallari: tek market ve onay, adet ve kalem sinirlari, azaltma.
 * Arayuzden bagimsiz: tasarim bastan degisse de bu testler gecerli kalir.
 */

import { CART_ITEM_MAX_QUANTITY, CART_MAX_ITEMS } from '@getir/contracts';
import type { Product } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  addItem,
  canAdd,
  canIncrement,
  decrementItem,
  EMPTY_CART,
  incrementItem,
  isSoldOut,
  itemCount,
  lineTotalMinor,
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
  isActive: true,
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

  it('kalem tutari birim fiyat x adet, kurus (Sepetim paneli, T11.12)', () => {
    const [line] = addMany(EMPTY_CART, SUT, 3).items;

    expect(line === undefined ? undefined : lineTotalMinor(line)).toBe(3 * 3490);
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

describe('satista olmayan teklif (T7.6)', () => {
  const PASIF = { ...product('camasir-suyu'), isActive: false };

  it('eklenmez; sepet degismez ve canAdd hayir der', () => {
    const { state, outcome } = addItem(EMPTY_CART, PASIF, MIGROS);

    expect(outcome).toEqual({ status: 'unavailable' });
    expect(state).toBe(EMPTY_CART);
    expect(canAdd(EMPTY_CART, PASIF)).toBe(false);
  });

  it('baska marketin pasif teklifi icin market degisimi HIC sorulmaz', () => {
    const migrosSepeti = addItem(EMPTY_CART, SUT, MIGROS).state;
    const pasifA101 = { ...product('camasir-suyu', 1990, A101.id), isActive: false };

    const { state, outcome } = addItem(migrosSepeti, pasifA101, A101);

    expect(outcome).toEqual({ status: 'unavailable' });
    expect(state).toBe(migrosSepeti);
  });
});

describe('stok siniri on kontrolu (T7.6)', () => {
  it('stok bilgisi varsa sinir stoktur: son adetten sonra eklenmez', () => {
    const azStok = { ...SUT, availableQuantity: 3 };
    const ucAdet = addMany(EMPTY_CART, azStok, 3);

    const { state, outcome } = addItem(ucAdet, azStok, MIGROS);

    expect(quantityOf(ucAdet, azStok.offerId)).toBe(3);
    expect(outcome).toEqual({ status: 'limit-reached', limit: 'stock' });
    expect(state).toBe(ucAdet);
    expect(canAdd(ucAdet, azStok)).toBe(false);
    expect(canAdd(addMany(EMPTY_CART, azStok, 2), azStok)).toBe(true);
  });

  it('stok 0: ilk adet de eklenmez', () => {
    const tukendi = { ...SUT, availableQuantity: 0 };

    expect(addItem(EMPTY_CART, tukendi, MIGROS).outcome).toEqual({
      status: 'limit-reached',
      limit: 'stock',
    });
    expect(canAdd(EMPTY_CART, tukendi)).toBe(false);
  });

  it(`stok ${CART_ITEM_MAX_QUANTITY} ve ustuyse platform siniri gecerli`, () => {
    const bolStok = { ...SUT, availableQuantity: 500 };
    const tamSinir = addMany(EMPTY_CART, bolStok, CART_ITEM_MAX_QUANTITY);

    expect(addItem(tamSinir, bolStok, MIGROS).outcome).toEqual({
      status: 'limit-reached',
      limit: 'quantity',
    });
  });

  it('stok bilgisi YOKSA (stok servisi cevap vermedi) yalnizca platform siniri: stok 0 sanilmaz', () => {
    expect(SUT.availableQuantity).toBeUndefined();
    expect(canAdd(addMany(EMPTY_CART, SUT, CART_ITEM_MAX_QUANTITY - 1), SUT)).toBe(true);
    expect(canAdd(addMany(EMPTY_CART, SUT, CART_ITEM_MAX_QUANTITY), SUT)).toBe(false);
  });
});

describe('tukendi (T8.4)', () => {
  it('stok bilgisi geldiyse ve 0 ise tukendi', () => {
    expect(isSoldOut({ ...SUT, availableQuantity: 0 })).toBe(true);
  });

  it('stok varsa ya da stok bilgisi yoksa tukenmis sayilmaz', () => {
    expect(isSoldOut({ ...SUT, availableQuantity: 2 })).toBe(false);
    expect(SUT.availableQuantity).toBeUndefined();
    expect(isSoldOut(SUT)).toBe(false);
  });

  it('pasif teklif tukendi degil "satista degil"dir: ikisi birlikteyse satis durumu kazanir', () => {
    expect(isSoldOut({ ...SUT, isActive: false, availableQuantity: 0 })).toBe(false);
  });
});

describe('canAdd: arayuzun tek sorusu (D11)', () => {
  const dolu = (): CartState => {
    let state: CartState = EMPTY_CART;
    for (let i = 0; i < CART_MAX_ITEMS; i += 1)
      state = addItem(state, product(`urun-${i}`), MIGROS).state;
    return state;
  };

  it(`${CART_MAX_ITEMS} kalemlik sepete ayni marketten YENI urun eklenemez, var olan artirilabilir`, () => {
    const state = dolu();

    expect(canAdd(state, product('yeni-urun'))).toBe(false);
    expect(canAdd(state, product('urun-0'))).toBe(true);
  });

  it('baska marketin urunu bos sepete gore sorulur: onayla yeni sepette eklenecek', () => {
    expect(canAdd(dolu(), product('sut-1l', 3210, A101.id))).toBe(true);
  });
});

describe('panelin "+"si: kalemdeki adet siniri (T16.3)', () => {
  it('kalem eklenirken urunun siniri kaleme yazilir: stok ya da platform siniri', () => {
    const azStok = { ...SUT, availableQuantity: 3 };

    expect(addItem(EMPTY_CART, azStok, MIGROS).state.items[0]?.maxQuantity).toBe(3);
    expect(addItem(EMPTY_CART, SUT, MIGROS).state.items[0]?.maxQuantity).toBe(
      CART_ITEM_MAX_QUANTITY,
    );
  });

  it('incrementItem sinira kadar artirir, sinirda durum aynen kalir; canIncrement ayni cevabi verir', () => {
    const azStok = { ...SUT, availableQuantity: 3 };
    const ikiAdet = addMany(EMPTY_CART, azStok, 2);

    const ucAdet = incrementItem(ikiAdet, azStok.offerId);
    expect(quantityOf(ucAdet, azStok.offerId)).toBe(3);
    expect(canIncrement(ikiAdet, azStok.offerId)).toBe(true);
    expect(canIncrement(ucAdet, azStok.offerId)).toBe(false);
    expect(incrementItem(ucAdet, azStok.offerId)).toBe(ucAdet);
  });

  it('urunden yeniden eklenince sinir guncel stokla tazelenir', () => {
    const ikiAdet = addMany(EMPTY_CART, { ...SUT, availableQuantity: 2 }, 2);

    const tazelenmis = addItem(
      decrementItem(ikiAdet, SUT.offerId),
      { ...SUT, availableQuantity: 5 },
      MIGROS,
    ).state;

    expect(tazelenmis.items[0]?.maxQuantity).toBe(5);
    expect(canIncrement(tazelenmis, SUT.offerId)).toBe(true);
  });

  it('sepette olmayan kalem artmaz', () => {
    const sepet = addMany(EMPTY_CART, SUT, 1);

    expect(incrementItem(sepet, EKMEK.offerId)).toBe(sepet);
    expect(canIncrement(sepet, EKMEK.offerId)).toBe(false);
  });
});

describe('satirin kategorisi: sepet sayfasinin gorseli (T16.3, L2)', () => {
  it('kalem eklenirken urunun kategorisi kaleme yazilir', () => {
    expect(addItem(EMPTY_CART, SUT, MIGROS).state.items[0]?.categoryId).toBe(SUT.categoryId);
  });

  it('kategorisi olmayan eski kalem urunden yeniden eklenince kategorisini alir', () => {
    const eski = addMany(EMPTY_CART, SUT, 1);
    const kategorisiz: CartState = {
      ...eski,
      items: eski.items.map(({ categoryId: _kategori, ...kalem }) => kalem),
    };

    const tazelenmis = addItem(kategorisiz, SUT, MIGROS).state;

    expect(kategorisiz.items[0]?.categoryId).toBeUndefined();
    expect(tazelenmis.items[0]?.categoryId).toBe(SUT.categoryId);
    expect(quantityOf(tazelenmis, SUT.offerId)).toBe(2);
  });
});

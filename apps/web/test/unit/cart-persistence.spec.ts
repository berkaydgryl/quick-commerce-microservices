/**
 * Sepetin kalici yazimi (T7.6): yenilemede sepet kalir; 24 saat, surum ve
 * bozuk kayit kurallari. Depo bellek icidir, saat sabittir: test tarayiciya ve
 * gercek zamana bagli degil.
 */

import { CART_ITEM_MAX_QUANTITY } from '@getir/contracts';
import type { Product } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  CART_STORAGE_KEY,
  CART_STORAGE_VERSION,
  CART_TTL_MS,
  isCartStorageKey,
  restoreCart,
  toPersistedCart,
} from '../../src/features/cart/services/cart-persistence';
import { addItem, EMPTY_CART } from '../../src/features/cart/services/cart-state';
import type { CartState } from '../../src/features/cart/services/cart-state';
import { createCartStore } from '../../src/features/cart/stores/useCartStore';
import { createMemoryStorage } from '../../src/shared/services/storage';
import type { KeyValueStorage } from '../../src/shared/services/storage';

const MIGROS = { id: 'mkt_migros-jet-moda', name: 'Migros Jet – Moda' };
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

const SUT: Product = {
  id: 'prd_sut-1l',
  offerId: 'ofr_migros-jet-moda-sut-1l',
  marketId: MIGROS.id,
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  categoryId: 'cat_sut-kahvaltilik',
  price: { amountMinor: 3490, currency: 'TRY' },
  isActive: true,
};

const ikiSut = (): CartState => {
  const bir = addItem(EMPTY_CART, SUT, MIGROS).state;
  return addItem(bir, SUT, MIGROS).state;
};

/** Depoya elle kayit yazar: baska surum, elle degistirilmis ya da bozuk kayit. */
const writeRaw = (storage: KeyValueStorage, value: unknown): void =>
  storage.setItem(CART_STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));

/** Sayfayi "yeniden acar": ayni depo, verilen saat, yeni store. */
const reload = (storage: KeyValueStorage, now: number) =>
  createCartStore({ storage: () => storage, now: () => now });

describe('restoreCart (okunan kaydin dogrulanmasi)', () => {
  const kayit = toPersistedCart(ikiSut(), NOW);

  it('gecerli kayit sepete doner', () => {
    expect(restoreCart(kayit, NOW + 1_000)).toEqual(ikiSut());
  });

  it('T16.3 oncesi kayit (kalemde maxQuantity yok) atilmaz: sinir platform siniri olur', () => {
    const eski = {
      ...kayit,
      items: kayit.items.map(({ maxQuantity: _sinir, ...kalem }) => kalem),
    };

    const sepet = restoreCart(eski, NOW + 1_000);

    expect(sepet.items).toHaveLength(1);
    expect(sepet.items[0]?.maxQuantity).toBe(CART_ITEM_MAX_QUANTITY);
  });

  it('kalemde kategori yoksa (T16.3 oncesi) kayit atilmaz; varsa gidip gelir', () => {
    const eski = {
      ...kayit,
      items: kayit.items.map(({ categoryId: _kategori, ...kalem }) => kalem),
    };

    const sepet = restoreCart(eski, NOW + 1_000);

    expect(sepet.items).toHaveLength(1);
    expect(sepet.items[0]?.categoryId).toBeUndefined();
    expect(restoreCart(kayit, NOW + 1_000).items[0]?.categoryId).toBe(SUT.categoryId);
  });

  it('kalemin siniri kayittan aynen doner', () => {
    const azStok = addItem(EMPTY_CART, { ...SUT, availableQuantity: 4 }, MIGROS).state;

    expect(restoreCart(toPersistedCart(azStok, NOW), NOW + 1_000).items[0]?.maxQuantity).toBe(4);
  });

  it('24 saat dolunca bos sepet', () => {
    expect(restoreCart(kayit, NOW + CART_TTL_MS - 1)).toEqual(ikiSut());
    expect(restoreCart(kayit, NOW + CART_TTL_MS)).toBe(EMPTY_CART);
  });

  it.each([
    ['kayit yok', undefined],
    ['nesne degil', 'sepet'],
    [
      'adet sinir ustu',
      { ...kayit, items: [{ ...kayit.items[0], quantity: CART_ITEM_MAX_QUANTITY + 1 }] },
    ],
    ['adet 0', { ...kayit, items: [{ ...kayit.items[0], quantity: 0 }] }],
    [
      'teklif kimligi bicimsiz',
      { ...kayit, items: [{ ...kayit.items[0], offerId: 'baska-bir-sey' }] },
    ],
    ['kalem var market yok', { ...kayit, market: null }],
    ['ayni teklif iki kalem', { ...kayit, items: [kayit.items[0], kayit.items[0]] }],
    ['saat bilgisi yok', { market: kayit.market, items: kayit.items }],
  ])('bozuk kayit bos sepet: %s', (_durum, bozuk) => {
    expect(restoreCart(bozuk, NOW)).toBe(EMPTY_CART);
  });

  it('bos kalemli kayit bos sepettir (market de tutulmaz)', () => {
    expect(restoreCart({ savedAt: NOW, market: MIGROS, items: [] }, NOW)).toBe(EMPTY_CART);
  });
});

describe('store: yenilemede sepet kalir', () => {
  it('eklenen urun yeni acilista geri gelir', () => {
    const storage = createMemoryStorage();
    reload(storage, NOW).getState().add(SUT, MIGROS);

    const acilis = reload(storage, NOW + 60_000).getState();

    expect(acilis.market).toEqual(MIGROS);
    expect(acilis.items).toMatchObject([{ offerId: SUT.offerId, quantity: 1 }]);
  });

  it('depoya yalnizca sepet ve surum yazilir; aksiyonlar yazilmaz', () => {
    const storage = createMemoryStorage();
    reload(storage, NOW).getState().add(SUT, MIGROS);

    const raw: unknown = JSON.parse(storage.getItem(CART_STORAGE_KEY) ?? 'null');

    expect(raw).toEqual({
      state: { savedAt: NOW, market: MIGROS, items: [expect.objectContaining({ quantity: 1 })] },
      version: CART_STORAGE_VERSION,
    });
  });

  it('son degisiklikten 24 saat sonra acilista sepet bostur', () => {
    const storage = createMemoryStorage();
    reload(storage, NOW).getState().add(SUT, MIGROS);

    expect(reload(storage, NOW + CART_TTL_MS).getState().items).toEqual([]);
  });

  it('eski surumlu kayit sessizce atilir ve yerine guncel surum yazilir', () => {
    const storage = createMemoryStorage();
    writeRaw(storage, { state: toPersistedCart(ikiSut(), NOW), version: CART_STORAGE_VERSION - 1 });

    const store = reload(storage, NOW);

    expect(store.getState().items).toEqual([]);
    expect(JSON.parse(storage.getItem(CART_STORAGE_KEY) ?? 'null')).toMatchObject({
      version: CART_STORAGE_VERSION,
    });
  });

  it.each([
    ['JSON degil', '{bozuk'],
    [
      'elle degistirilmis adet',
      { state: { ...toPersistedCart(ikiSut(), NOW), items: [{ quantity: 500 }] }, version: 1 },
    ],
  ])('bozuk kayitla acilis bos sepetle baslar, hata firlatmaz: %s', (_durum, bozuk) => {
    const storage = createMemoryStorage();
    writeRaw(storage, bozuk);

    expect(reload(storage, NOW).getState().items).toEqual([]);
  });
});

describe('sekmeler arasi (T7.6)', () => {
  it('baska sekmenin yazdigi sepet yeniden okununca bu sekmeye gelir', () => {
    const storage = createMemoryStorage();
    const sekmeA = reload(storage, NOW);
    const sekmeB = reload(storage, NOW);

    sekmeA.getState().add(SUT, MIGROS);
    expect(sekmeB.getState().items).toEqual([]);

    // Tarayici B'ye `storage` olayi yollar; useCartStorageSync bunu yapar.
    void sekmeB.persist.rehydrate();

    expect(sekmeB.getState().items).toMatchObject([{ offerId: SUT.offerId, quantity: 1 }]);
  });

  it('olay yalnizca sepet anahtari ya da tum depo temizligi icin ilgilidir', () => {
    expect(isCartStorageKey(CART_STORAGE_KEY)).toBe(true);
    expect(isCartStorageKey(null)).toBe(true);
    expect(isCartStorageKey('getir.auth')).toBe(false);
  });
});

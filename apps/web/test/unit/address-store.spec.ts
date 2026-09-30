/**
 * Secili teslimat adresinin kalici yazimi (T9.5): yenilemede secim kalir;
 * surum ve bozuk kayit kurallari; sekmeler arasi esitleme. Depo bellek icidir:
 * test tarayiciya bagli degil.
 */

import { describe, expect, it } from 'vitest';

import {
  ADDRESS_STORAGE_KEY,
  ADDRESS_STORAGE_VERSION,
  restoreSelection,
  shouldRehydrateAddress,
} from '../../src/features/address/services/address-selection';
import { createAddressStore } from '../../src/features/address/stores/useAddressStore';
import { createMemoryStorage } from '../../src/shared/services/storage';
import type { KeyValueStorage } from '../../src/shared/services/storage';

const AYSE = 'usr_0123456789abcdef0123456789abcdef';
const IS_SECIMI = { userId: AYSE, title: 'İş' };

/** Depoya elle kayit yazar: baska surum, elle degistirilmis ya da bozuk kayit. */
const writeRaw = (storage: KeyValueStorage, value: unknown): void =>
  storage.setItem(ADDRESS_STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));

const readRaw = (storage: KeyValueStorage): unknown =>
  JSON.parse(storage.getItem(ADDRESS_STORAGE_KEY) ?? 'null');

/** Sayfayi "yeniden acar": ayni depo, yeni store. */
const reload = (storage: KeyValueStorage) => createAddressStore({ storage: () => storage });

describe('anahtar ve surum', () => {
  it("roadmap'teki anahtar: getir.address (degisirse kayitli secimler sessizce kaybolur)", () => {
    expect(ADDRESS_STORAGE_KEY).toBe('getir.address');
    expect(ADDRESS_STORAGE_VERSION).toBe(1);
  });
});

describe('restoreSelection (okunan kaydin dogrulanmasi)', () => {
  it('gecerli kayit secime doner', () => {
    expect(restoreSelection({ selection: IS_SECIMI })).toEqual(IS_SECIMI);
  });

  it('secim yok kaydi secim yoktur', () => {
    expect(restoreSelection({ selection: null })).toBeNull();
  });

  it.each([
    ['kayit yok', undefined],
    ['nesne degil', 'İş'],
    ['secim alani yok', {}],
    ['kullanici kimligi bicimsiz', { selection: { userId: 'ayse', title: 'İş' } }],
    ['kullanici yok', { selection: { title: 'İş' } }],
    ['ad bos', { selection: { userId: AYSE, title: '   ' } }],
    ['ad metin degil', { selection: { userId: AYSE, title: 3 } }],
  ])('bozuk kayit secim yoktur: %s', (_durum, bozuk) => {
    expect(restoreSelection(bozuk)).toBeNull();
  });
});

describe('store: yenilemede secim kalir', () => {
  it('secilen adres yeni acilista geri gelir', () => {
    const storage = createMemoryStorage();
    reload(storage).getState().select(IS_SECIMI);

    expect(reload(storage).getState().selection).toEqual(IS_SECIMI);
  });

  it('depoya yalnizca secim ve surum yazilir; aksiyonlar yazilmaz', () => {
    const storage = createMemoryStorage();
    reload(storage).getState().select(IS_SECIMI);

    expect(readRaw(storage)).toEqual({
      state: { selection: IS_SECIMI },
      version: ADDRESS_STORAGE_VERSION,
    });
  });

  it('kayit yoksa secim yok', () => {
    expect(reload(createMemoryStorage()).getState().selection).toBeNull();
  });

  it('eski surumlu kayit sessizce atilir ve yerine guncel surum yazilir', () => {
    const storage = createMemoryStorage();
    writeRaw(storage, { state: { selection: IS_SECIMI }, version: ADDRESS_STORAGE_VERSION - 1 });

    const store = reload(storage);

    expect(store.getState().selection).toBeNull();
    expect(readRaw(storage)).toEqual({
      state: { selection: null },
      version: ADDRESS_STORAGE_VERSION,
    });
  });

  it.each([
    ['JSON degil', '{bozuk'],
    [
      'elle degistirilmis kimlik',
      { state: { selection: { userId: 'baska', title: 'İş' } }, version: ADDRESS_STORAGE_VERSION },
    ],
  ])('bozuk kayitla acilis secimsiz baslar, hata firlatmaz: %s', (_durum, bozuk) => {
    const storage = createMemoryStorage();
    writeRaw(storage, bozuk);

    expect(reload(storage).getState().selection).toBeNull();
  });
});

describe('sekmeler arasi', () => {
  it('baska sekmenin yazdigi secim yeniden okununca bu sekmeye gelir', () => {
    const storage = createMemoryStorage();
    const sekmeA = reload(storage);
    const sekmeB = reload(storage);

    sekmeA.getState().select(IS_SECIMI);
    expect(sekmeB.getState().selection).toBeNull();

    // Tarayici B'ye `storage` olayi yollar; useAddressStorageSync bunu yapar.
    void sekmeB.persist.rehydrate();

    expect(sekmeB.getState().selection).toEqual(IS_SECIMI);
  });

  it('baska sekmede kayit silinince (clear, removeItem) bu sekmede de secim kalkar', () => {
    const storage = createMemoryStorage();
    const sekmeA = reload(storage);
    const sekmeB = reload(storage);
    sekmeA.getState().select(IS_SECIMI);
    void sekmeB.persist.rehydrate();
    expect(sekmeB.getState().selection).toEqual(IS_SECIMI);

    storage.removeItem(ADDRESS_STORAGE_KEY);
    void sekmeB.persist.rehydrate();

    expect(sekmeB.getState().selection).toBeNull();
  });

  it('olay bu surumun kaydi, kaydin silinmesi ya da tum depo temizligi icin ilgilidir', () => {
    const buSurum = JSON.stringify({
      state: { selection: IS_SECIMI },
      version: ADDRESS_STORAGE_VERSION,
    });

    expect(shouldRehydrateAddress(ADDRESS_STORAGE_KEY, buSurum)).toBe(true);
    expect(shouldRehydrateAddress(ADDRESS_STORAGE_KEY, null)).toBe(true);
    expect(shouldRehydrateAddress(null, null)).toBe(true);
    expect(shouldRehydrateAddress('getir.cart', buSurum)).toBe(false);
  });

  it.each([
    [
      'eski surum',
      JSON.stringify({ state: { selection: null }, version: ADDRESS_STORAGE_VERSION - 1 }),
    ],
    [
      'yeni surum',
      JSON.stringify({ state: { selection: null }, version: ADDRESS_STORAGE_VERSION + 1 }),
    ],
    ['surumsuz', JSON.stringify({ state: { selection: null } })],
    ['JSON degil', '{bozuk'],
  ])(
    'baska surumun ya da okunamayan kayit okunmaz (iki surumlu sekme birbirini sonsuza dek ezmesin): %s',
    (_durum, raw) => {
      expect(shouldRehydrateAddress(ADDRESS_STORAGE_KEY, raw)).toBe(false);
    },
  );
});

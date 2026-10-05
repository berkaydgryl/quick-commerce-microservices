/**
 * Secili teslimat adresinin kalici yazimi (T9.5; T11.15'te kimlikle, surum 2):
 * yenilemede secim kalir; surum 1'in adla secimi tasinir ve kimlige cevrilir;
 * surum ve bozuk kayit kurallari; sekmeler arasi esitleme. Depo bellek icidir:
 * test tarayiciya bagli degil.
 */

import type { SavedAddress } from '@getir/contracts';

import { describe, expect, it } from 'vitest';

import {
  ADDRESS_STORAGE_KEY,
  ADDRESS_STORAGE_VERSION,
  LEGACY_ADDRESS_STORAGE_VERSION,
  findSelected,
  restoreSelection,
  shouldRehydrateAddress,
  upgradeSelection,
} from '../../src/features/address/services/address-selection';
import { createAddressStore } from '../../src/features/address/stores/useAddressStore';
import { createMemoryStorage } from '../../src/shared/services/storage';
import type { KeyValueStorage } from '../../src/shared/services/storage';

const AYSE = 'usr_0123456789abcdef0123456789abcdef';
const MEHMET = 'usr_fedcba9876543210fedcba9876543210';
const IS_ID = 'adr_00000000000000000000000000000002';
const IS_SECIMI = { userId: AYSE, addressId: IS_ID };
/** Surum 1'in (T9.5-T11.14) adla secimi. */
const ESKI_SECIM = { userId: AYSE, title: 'İş' };

const adres = (id: string, title: string): SavedAddress => ({
  id,
  title,
  line: `${title} satiri`,
  location: { lat: 41, lng: 29 },
});
const DEFTER = [adres('adr_00000000000000000000000000000001', 'Ev'), adres(IS_ID, 'İş')];

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
    expect(ADDRESS_STORAGE_VERSION).toBe(2);
    expect(LEGACY_ADDRESS_STORAGE_VERSION).toBe(1);
  });
});

describe('restoreSelection (okunan kaydin dogrulanmasi)', () => {
  it('gecerli kayit secime doner; tasinmis adla secim de (cevrilene kadar)', () => {
    expect(restoreSelection({ selection: IS_SECIMI })).toEqual(IS_SECIMI);
    expect(restoreSelection({ selection: ESKI_SECIM })).toEqual(ESKI_SECIM);
  });

  it('secim yok kaydi secim yoktur', () => {
    expect(restoreSelection({ selection: null })).toBeNull();
  });

  it.each([
    ['kayit yok', undefined],
    ['nesne degil', 'İş'],
    ['secim alani yok', {}],
    ['kullanici kimligi bicimsiz', { selection: { userId: 'ayse', addressId: IS_ID } }],
    ['kullanici yok', { selection: { addressId: IS_ID } }],
    ['adres kimligi bicimsiz', { selection: { userId: AYSE, addressId: 'İş' } }],
    ['adres kimligi baska onekle', { selection: { userId: AYSE, addressId: AYSE } }],
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

  it('surum 1 kaydi (adla secim) TASINIR: secim kaybolmaz, guncel surumle yazilir (K3)', () => {
    const storage = createMemoryStorage();
    writeRaw(storage, {
      state: { selection: ESKI_SECIM },
      version: LEGACY_ADDRESS_STORAGE_VERSION,
    });

    const store = reload(storage);

    expect(store.getState().selection).toEqual(ESKI_SECIM);
    expect(readRaw(storage)).toEqual({
      state: { selection: ESKI_SECIM },
      version: ADDRESS_STORAGE_VERSION,
    });
  });

  it.each([
    ['surum 0', { state: { selection: ESKI_SECIM }, version: 0 }],
    ['gelecek surum', { state: { selection: IS_SECIMI }, version: ADDRESS_STORAGE_VERSION + 1 }],
    ['bozuk surum 1', { state: { selection: { userId: 'ayse', title: 'İş' } }, version: 1 }],
  ])('baska surumlu ya da bozuk eski kayit atilir: %s', (_durum, kayit) => {
    const storage = createMemoryStorage();
    writeRaw(storage, kayit);

    expect(reload(storage).getState().selection).toBeNull();
    expect(readRaw(storage)).toEqual({
      state: { selection: null },
      version: ADDRESS_STORAGE_VERSION,
    });
  });

  it.each([
    ['JSON degil', '{bozuk'],
    [
      'elle degistirilmis kimlik',
      {
        state: { selection: { userId: 'baska', addressId: IS_ID } },
        version: ADDRESS_STORAGE_VERSION,
      },
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

describe('adla secimin kimlige cevrilmesi (K3 (a))', () => {
  it('defterde o adda adres varsa kimlikle secim olur', () => {
    expect(upgradeSelection(ESKI_SECIM, AYSE, DEFTER)).toEqual(IS_SECIMI);
  });

  it.each([
    ['secim yok', null, AYSE, DEFTER],
    ['oturum yok', ESKI_SECIM, null, DEFTER],
    ['baska hesabin secimi', ESKI_SECIM, MEHMET, DEFTER],
    ['o adda adres yok (silinmis ya da adi degismis)', ESKI_SECIM, AYSE, [DEFTER[0]!]],
    ['secim zaten kimlikli', IS_SECIMI, AYSE, DEFTER],
  ] as const)('cevrilecek bir sey yok: %s', (_durum, secim, kullanici, defter) => {
    expect(upgradeSelection(secim, kullanici, defter)).toBeUndefined();
  });

  it('findSelected kimlikle, tasinmis secimde adla bulur; ad degisse de kimlik tutar', () => {
    expect(findSelected(DEFTER, IS_SECIMI)?.title).toBe('İş');
    expect(findSelected(DEFTER, ESKI_SECIM)?.id).toBe(IS_ID);
    const adiDegisti = [DEFTER[0]!, { ...DEFTER[1]!, title: 'Ofis' }];
    expect(findSelected(adiDegisti, IS_SECIMI)?.title).toBe('Ofis');
    expect(findSelected(adiDegisti, ESKI_SECIM)).toBeUndefined();
  });
});

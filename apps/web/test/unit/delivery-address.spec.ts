/**
 * Hangi teslimat adresi gecerli (T9.5, saf kural): oturum, adres defteri ve
 * secim. Varsayilan adresin seed'deki "Ev" ile ayni kaldigi da burada
 * denetlenir (apps/gateway/internal/persona/addresses.json).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { savedAddressSchema } from '@getir/contracts';
import type { SavedAddress } from '@getir/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEFAULT_ADDRESS_TITLE,
  DEFAULT_DELIVERY_LOCATION,
} from '../../src/features/address/constants';
import {
  addressBookState,
  resolveDeliveryAddress,
  selectedAddress,
} from '../../src/features/address/services/delivery-address';
import type {
  DeliveryAddressState,
  DeliveryInputs,
} from '../../src/features/address/services/delivery-address';

const SEED_ADDRESSES_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../gateway/internal/persona/addresses.json',
);

// Dosyada kimlik yok: gateway her personaya kimligi seed aninda turetir (T11.15).
const seed = z
  .array(savedAddressSchema.omit({ id: true }))
  .parse(JSON.parse(readFileSync(SEED_ADDRESSES_JSON, 'utf8')))
  .map((address, index) => ({ ...address, id: `adr_${String(index + 1).padStart(32, '0')}` }));

const AYSE = 'usr_0123456789abcdef0123456789abcdef';
const MEHMET = 'usr_fedcba9876543210fedcba9876543210';

const EV: SavedAddress = {
  id: 'adr_00000000000000000000000000000001',
  title: 'Ev',
  line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
  location: { lat: 40.9885, lng: 29.0262 },
};
const IS: SavedAddress = {
  id: 'adr_00000000000000000000000000000002',
  title: 'İş',
  line: 'Sinanpaşa Mah. Barbaros Blv. No:40, Beşiktaş',
  location: { lat: 41.0431, lng: 29.0071 },
};
const YAZLIK: SavedAddress = {
  id: 'adr_00000000000000000000000000000003',
  title: 'Yazlık',
  line: 'Ağva Mah. Sahil Yolu No:3, Şile',
  location: { lat: 41.1363, lng: 29.8539 },
};

const signedIn = (overrides: Partial<DeliveryInputs> = {}): DeliveryInputs => ({
  session: 'authenticated',
  userId: AYSE,
  addresses: [EV, IS, YAZLIK],
  selection: null,
  ...overrides,
});

const defaultAddress = (reason: string) => ({
  status: 'ready',
  source: 'default',
  reason,
  title: DEFAULT_ADDRESS_TITLE,
  location: DEFAULT_DELIVERY_LOCATION,
});

describe('resolveDeliveryAddress: beklenir', () => {
  it('oturum henuz bilinmiyor: acilistaki sessiz yenileme bitmeden konum yok', () => {
    expect(
      resolveDeliveryAddress({
        session: 'unknown',
        userId: null,
        addresses: 'loading',
        selection: { userId: AYSE, addressId: IS.id },
      }),
    ).toEqual({ status: 'pending' });
  });

  it('oturum acik, defter yukleniyor: once varsayilana gidip sonra degismez', () => {
    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: 'loading', selection: { userId: AYSE, addressId: IS.id } }),
      ),
    ).toEqual({ status: 'pending' });
  });
});

describe('resolveDeliveryAddress: varsayilan "Ev" ve nedeni', () => {
  it('oturumsuz ziyaretci', () => {
    expect(
      resolveDeliveryAddress({
        session: 'anonymous',
        userId: null,
        addresses: 'loading',
        selection: null,
      }),
    ).toEqual(defaultAddress('anonymous'));
  });

  it('oturumsuzken depodaki eski secim uygulanmaz', () => {
    expect(
      resolveDeliveryAddress({
        session: 'anonymous',
        userId: null,
        addresses: 'loading',
        selection: { userId: AYSE, addressId: IS.id },
      }),
    ).toEqual(defaultAddress('anonymous'));
  });

  it('adresi olmayan hesap', () => {
    expect(resolveDeliveryAddress(signedIn({ addresses: [] }))).toEqual(
      defaultAddress('no-addresses'),
    );
  });

  it('defter okunamadi', () => {
    expect(resolveDeliveryAddress(signedIn({ addresses: 'error' }))).toEqual(
      defaultAddress('unavailable'),
    );
  });
});

/** Hesabin adresi olarak cozulmus durum. */
const account = (address: SavedAddress) => ({
  status: 'ready',
  source: 'account',
  addressId: address.id,
  title: address.title,
  location: address.location,
});

describe('resolveDeliveryAddress: hesabin adresi', () => {
  it('secim yoksa defterin ilk adresi', () => {
    expect(resolveDeliveryAddress(signedIn())).toEqual(account(EV));
  });

  it('kullanicinin secimi (kimlikle), defterinde o kimlikte adres varsa', () => {
    expect(
      resolveDeliveryAddress(signedIn({ selection: { userId: AYSE, addressId: IS.id } })),
    ).toEqual(account(IS));
  });

  it('adi degisen adres secili kalir: secim kimliktir (T11.15)', () => {
    const ofis: SavedAddress = { ...IS, title: 'Ofis' };

    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: [EV, ofis], selection: { userId: AYSE, addressId: IS.id } }),
      ),
    ).toEqual(account(ofis));
  });

  // Asagidaki defterler "Ev" ile BASLAMAZ: ilk adres varsayilandan ayirt edilsin
  // (seed'in "Ev"i varsayilanla ayni konumdadir).
  it('baska hesabin secimi uygulanmaz: ayni tarayicida ikinci kullanici KENDI ilk adresini gorur', () => {
    expect(
      resolveDeliveryAddress(
        signedIn({
          addresses: [IS, EV, YAZLIK],
          selection: { userId: MEHMET, addressId: YAZLIK.id },
        }),
      ),
    ).toEqual(account(IS));
  });

  it('secili adres silinmisse defterin ilk adresi (K6)', () => {
    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: [IS, YAZLIK], selection: { userId: AYSE, addressId: EV.id } }),
      ),
    ).toEqual(account(IS));
  });

  it('surum 1 kaydindan tasinmis adla secim, kimlige cevrilene kadar adla eslesir', () => {
    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: [YAZLIK, IS], selection: { userId: AYSE, title: 'İş' } }),
      ),
    ).toEqual(account(IS));
  });

  it.each([
    ['kucuk harf', 'İş'.toLocaleLowerCase('tr')],
    ['buyuk harf', 'İş'.toLocaleUpperCase('tr')],
    ['Turkce karaktersiz', 'Is'],
  ])(
    'tasinmis adla secimde ad birebir eslesir: %s secim "İş"i secmez, ilk adres',
    (_durum, title) => {
      expect(
        resolveDeliveryAddress(
          signedIn({ addresses: [YAZLIK, IS], selection: { userId: AYSE, title } }),
        ),
      ).toEqual(account(YAZLIK));
    },
  );
});

describe('selectedAddress (secicinin ve Adreslerim sekmesinin "secili" isareti)', () => {
  it('hesabin adresi: defterdeki kaydi', () => {
    expect(selectedAddress([EV, IS], account(IS) as DeliveryAddressState)).toBe(IS);
  });

  it('varsayilan adres ve bekleme: hicbiri secili degil (varsayilan defterde yok)', () => {
    expect(
      selectedAddress([EV, IS], defaultAddress('no-addresses') as DeliveryAddressState),
    ).toBeUndefined();
    expect(selectedAddress([EV, IS], { status: 'pending' })).toBeUndefined();
  });
});

describe('addressBookState (sorgu -> resolveDeliveryAddress girdisi)', () => {
  it('veri varsa o; yenileme hatasi eski listeyi silmez (secim ve konum kalir)', () => {
    expect(addressBookState({ data: [IS], isError: true, errorUpdateCount: 1 })).toEqual([IS]);
    expect(addressBookState({ data: [], isError: false, errorUpdateCount: 0 })).toEqual([]);
  });

  it('veri yok, hic hata yok: yukleniyor (ilk okuma bitmeden konuma istek gitmez)', () => {
    expect(addressBookState({ data: undefined, isError: false, errorUpdateCount: 0 })).toBe(
      'loading',
    );
  });

  it('veri yok, hata: okunamadi', () => {
    expect(addressBookState({ data: undefined, isError: true, errorUpdateCount: 1 })).toBe('error');
  });

  it('hatadan sonra yeniden denerken de okunamadi: konum varsayilanda kalir, bolumler bosalmaz', () => {
    // TanStack yeni denemede veri yoksa hatayi siler (isError false), sayac kalir.
    expect(addressBookState({ data: undefined, isError: false, errorUpdateCount: 2 })).toBe(
      'error',
    );
  });
});

describe('varsayilan adres seed ile ayni', () => {
  it('seed\'in ilk adresi "Ev"; konumu DEFAULT_DELIVERY_LOCATION', () => {
    expect(seed[0]?.title).toBe(DEFAULT_ADDRESS_TITLE);
    expect(seed[0]?.location).toEqual(DEFAULT_DELIVERY_LOCATION);
  });

  it("testteki adresler seed'in kopyasi (not haric; kimlik testin)", () => {
    expect(seed.map(({ id, title, line, location }) => ({ id, title, line, location }))).toEqual([
      EV,
      IS,
      YAZLIK,
    ]);
  });
});

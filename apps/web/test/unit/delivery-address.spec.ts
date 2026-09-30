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
  selectedAddressIndex,
} from '../../src/features/address/services/delivery-address';
import type { DeliveryInputs } from '../../src/features/address/services/delivery-address';

const SEED_ADDRESSES_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../gateway/internal/persona/addresses.json',
);

const seed = z
  .array(savedAddressSchema)
  .parse(JSON.parse(readFileSync(SEED_ADDRESSES_JSON, 'utf8')));

const AYSE = 'usr_0123456789abcdef0123456789abcdef';
const MEHMET = 'usr_fedcba9876543210fedcba9876543210';

const EV: SavedAddress = {
  title: 'Ev',
  line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
  location: { lat: 40.9885, lng: 29.0262 },
};
const IS: SavedAddress = {
  title: 'İş',
  line: 'Sinanpaşa Mah. Barbaros Blv. No:40, Beşiktaş',
  location: { lat: 41.0431, lng: 29.0071 },
};
const YAZLIK: SavedAddress = {
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
        selection: { userId: AYSE, title: 'İş' },
      }),
    ).toEqual({ status: 'pending' });
  });

  it('oturum acik, defter yukleniyor: once varsayilana gidip sonra degismez', () => {
    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: 'loading', selection: { userId: AYSE, title: 'İş' } }),
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
        selection: { userId: AYSE, title: 'İş' },
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

describe('resolveDeliveryAddress: hesabin adresi', () => {
  it('secim yoksa defterin ilk adresi', () => {
    expect(resolveDeliveryAddress(signedIn())).toEqual({
      status: 'ready',
      source: 'account',
      title: 'Ev',
      location: EV.location,
    });
  });

  it('kullanicinin secimi, defterinde o adda adres varsa', () => {
    expect(resolveDeliveryAddress(signedIn({ selection: { userId: AYSE, title: 'İş' } }))).toEqual({
      status: 'ready',
      source: 'account',
      title: 'İş',
      location: IS.location,
    });
  });

  // Asagidaki defterler "Ev" ile BASLAMAZ: ilk adres varsayilandan ayirt edilsin
  // (seed'in "Ev"i varsayilanla ayni konumdadir).
  it('baska hesabin secimi uygulanmaz: ayni tarayicida ikinci kullanici KENDI ilk adresini gorur', () => {
    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: [IS, EV, YAZLIK], selection: { userId: MEHMET, title: 'Yazlık' } }),
      ),
    ).toEqual({ status: 'ready', source: 'account', title: 'İş', location: IS.location });
  });

  it('secilen adres defterden kalkmissa ilk adres', () => {
    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: [IS, YAZLIK], selection: { userId: AYSE, title: 'Ev' } }),
      ),
    ).toEqual({ status: 'ready', source: 'account', title: 'İş', location: IS.location });
  });

  it.each([
    ['kucuk harf', 'İş'.toLocaleLowerCase('tr')],
    ['buyuk harf', 'İş'.toLocaleUpperCase('tr')],
    ['Turkce karaktersiz', 'Is'],
  ])('ad birebir eslesir: %s secim "Is" adresini secmez, ilk adres', (_durum, title) => {
    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: [YAZLIK, IS], selection: { userId: AYSE, title } }),
      ),
    ).toEqual({ status: 'ready', source: 'account', title: 'Yazlık', location: YAZLIK.location });
  });

  it('ayni adli iki adreste ilki gecerli (adres adiyla taninir; kimlik sozlesmede yok)', () => {
    const baskaEv: SavedAddress = {
      ...EV,
      line: 'Kizilay Mah. No:1, Cankaya',
      location: IS.location,
    };

    expect(
      resolveDeliveryAddress(
        signedIn({ addresses: [YAZLIK, EV, baskaEv], selection: { userId: AYSE, title: 'Ev' } }),
      ),
    ).toEqual({ status: 'ready', source: 'account', title: 'Ev', location: EV.location });
  });
});

describe('selectedAddressIndex (secicinin "secili" isareti)', () => {
  it('o adi tasiyan ILK adres: ayni adli ikinci adres secili gorunmez (cozum de ilkini alir)', () => {
    const baskaEv: SavedAddress = { ...EV, line: 'Kizilay Mah. No:1, Cankaya' };

    expect(selectedAddressIndex([YAZLIK, EV, baskaEv], 'Ev')).toBe(1);
  });

  it('defterde olmayan ad: hicbiri secili degil', () => {
    expect(selectedAddressIndex([EV, IS], 'Yazlık')).toBe(-1);
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

  it("testteki adresler seed'in kopyasi (not haric)", () => {
    expect(seed.map(({ title, line, location }) => ({ title, line, location }))).toEqual([
      EV,
      IS,
      YAZLIK,
    ]);
  });
});

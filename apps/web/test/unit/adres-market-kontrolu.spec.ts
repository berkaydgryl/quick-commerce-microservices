/**
 * Adres degisince market kontrolu (F16; PM S1-S3 a): sepetin marketi yeni
 * konuma teslim etmiyorsa onay sorulur; bos sepette ve teslim ediyorsa adres
 * hemen degisir; yakin marketler okunamazsa adres degisir ve uyari gunluge
 * duser (kisisel veri yok). Sepet "Evet"te degil izin commit edilince
 * (adres gercekten degisince) bosalir. Kayit gecerli adresi kendiliginden
 * tasiyorsa (pin, ilk adres) soru kayittan once. Kural tek fonksiyonda.
 */

import type { SavedAddress } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { CancelledError } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredSelection } from '../../src/features/address/services/address-selection';
import { resolveDeliveryAddress } from '../../src/features/address/services/delivery-address';
import {
  addMovesDelivery,
  editMovesDelivery,
} from '../../src/features/address/services/delivery-move';
import {
  addressChangeVerdict,
  approveAddressChange,
  checkAddressChange,
  leavesStorePage,
} from '../../src/features/cart/services/address-change';
import { marketIdInPath } from '../../src/features/markets/routes';
import { KEEP_CART, useAddressChangeGuard } from '../../src/shared/address-change/guard';
import type { AddressChangeGuard } from '../../src/shared/address-change/guard';
import { readPastCancel } from '../../src/shared/api/read-past-cancel';
import { warnEvent } from '../../src/shared/diagnostics/warn';

const A101 = 'mkt_a101-caferaga';
const EV = { lat: 40.9885, lng: 29.0262 };

describe('kural (tek fonksiyon)', () => {
  it('bos sepet: hemen degisir; marketi teslim ediyorsa degisir; etmiyorsa sorulur; okunamadiysa dogrulanmadan', () => {
    expect(addressChangeVerdict({ cartMarketId: null, cartCount: 0, nearby: [] })).toBe('proceed');
    expect(addressChangeVerdict({ cartMarketId: A101, cartCount: 0, nearby: [] })).toBe('proceed');
    expect(
      addressChangeVerdict({
        cartMarketId: A101,
        cartCount: 2,
        nearby: [{ id: A101 }, { id: 'mkt_b' }],
      }),
    ).toBe('proceed');
    expect(
      addressChangeVerdict({ cartMarketId: A101, cartCount: 2, nearby: [{ id: 'mkt_b' }] }),
    ).toBe('ask');
    expect(addressChangeVerdict({ cartMarketId: A101, cartCount: 2, nearby: [] })).toBe('ask');
    expect(addressChangeVerdict({ cartMarketId: A101, cartCount: 2, nearby: 'error' })).toBe(
      'unverified',
    );
  });
});

describe('kontrol (okuma ve uyari)', () => {
  it('bos sepette yakin marketler OKUNMAZ', async () => {
    const readNearby = vi.fn(() => Promise.resolve([{ id: A101 }]));

    await expect(
      checkAddressChange({ cartMarketId: null, cartCount: 0, readNearby, onCheckFailed: vi.fn() }),
    ).resolves.toBe('proceed');
    expect(readNearby).not.toHaveBeenCalled();
  });

  it('okuma duserse adres degisir (S1 a) ve hata bildirilir', async () => {
    const onCheckFailed = vi.fn();
    const error = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x');

    await expect(
      checkAddressChange({
        cartMarketId: A101,
        cartCount: 1,
        readNearby: () => Promise.reject(error),
        onCheckFailed,
      }),
    ).resolves.toBe('unverified');
    expect(onCheckFailed).toHaveBeenCalledWith(error);
  });

  it('teslim etmeyen marketler: sorulur', async () => {
    await expect(
      checkAddressChange({
        cartMarketId: A101,
        cartCount: 1,
        readNearby: () => Promise.resolve([{ id: 'mkt_b' }]),
        onCheckFailed: vi.fn(),
      }),
    ).resolves.toBe('ask');
  });
});

describe('bekcinin karari (izin ve commit)', () => {
  const decide = (over: {
    nearby?: () => Promise<readonly { readonly id: string }[]>;
    answer?: boolean;
    latest?: boolean;
  }) => {
    const ask = vi.fn(() => Promise.resolve(over.answer ?? false));
    const clearCart = vi.fn();
    const onCheckFailed = vi.fn();
    const approval = approveAddressChange({
      cartMarketId: A101,
      cartCount: 2,
      readNearby: over.nearby ?? (() => Promise.resolve([{ id: 'mkt_b' }])),
      onCheckFailed,
      isLatest: () => over.latest ?? true,
      ask,
      clearCart,
    });
    return { approval, ask, clearCart, onCheckFailed };
  };

  it('"Evet": izin verilir ama sepet YALNIZ commit edilince bosalir (kayit duserse sepet kalir)', async () => {
    const { approval, ask, clearCart } = decide({ answer: true });
    const granted = await approval;

    expect(ask).toHaveBeenCalledOnce();
    expect(granted).not.toBeNull();
    expect(clearCart).not.toHaveBeenCalled();
    granted?.commit();
    // Yeni konuma teslim eden marketler commit'e gider (kalinan market sayfasi).
    expect(clearCart.mock.calls).toEqual([[['mkt_b']]]);
  });

  it('"Hayır": izin yok (adres degismez), sepete dokunulmaz', async () => {
    const { approval, clearCart } = decide({ answer: false });

    await expect(approval).resolves.toBeNull();
    expect(clearCart).not.toHaveBeenCalled();
  });

  it('market teslim ediyorsa ya da okunamazsa sorulmaz; izin sepete dokunmaz', async () => {
    const delivers = decide({ nearby: () => Promise.resolve([{ id: A101 }]) });
    const failing = decide({
      nearby: () => Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x')),
    });

    for (const { approval, ask } of [delivers, failing]) {
      await expect(approval).resolves.toBe(KEEP_CART);
      expect(ask).not.toHaveBeenCalled();
    }
    expect(failing.onCheckFailed).toHaveBeenCalledOnce();
  });

  it('okuma surerken yeni degisim basladiysa bu degisim duser: soru yok, izin yok', async () => {
    const stale = decide({ latest: false, answer: true });

    await expect(stale.approval).resolves.toBeNull();
    expect(stale.ask).not.toHaveBeenCalled();
    expect(stale.clearCart).not.toHaveBeenCalled();
  });
});

describe('"Evet"ten sonra kalinan sayfa (PM 08.10)', () => {
  it('yeni adrese teslim etmeyen marketin sayfasindan cikilir; teslim edenin ve baska sayfalarda kalinir', () => {
    expect(leavesStorePage(marketIdInPath('/markets/mkt_a101-caferaga'), ['mkt_b'])).toBe(true);
    expect(leavesStorePage(marketIdInPath('/markets/mkt_b'), ['mkt_b'])).toBe(false);
    for (const path of ['/markets', '/sepet', '/hesabim/adreslerim', '/', '/markets/mkt_b/x']) {
      expect(leavesStorePage(marketIdInPath(path), [])).toBe(false);
    }
  });

  it('market sayfasinin kimligi adresten cozulur', () => {
    expect(marketIdInPath('/markets/mkt_a101-caferaga')).toBe(A101);
    expect(marketIdInPath('/markets')).toBeUndefined();
  });
});

describe('onbellekten okuma (iptal yarisi)', () => {
  it('okunan sorgu baska pencere kapanirken iptal edilirse bir kez daha okunur', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new CancelledError())
      .mockResolvedValueOnce('liste');

    await expect(readPastCancel(read)).resolves.toBe('liste');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('baska hata yeniden okunmaz, aynen doner', async () => {
    const error = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x');
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(readPastCancel(read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledOnce();
  });
});

describe('uyari gunlugu (kisisel veri yok)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('yalniz olay adi, hata kodu ve istek kimligi; hata metni ve baska alan yazilmaz', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnEvent(
      'address-change-check-failed',
      new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Barbaros Blv. 41.0431', {
        requestId: 'req_1',
        details: { lat: 41.0431 },
      }),
    );
    warnEvent('address-change-check-failed', new AppError(ERROR_CODES.INTERNAL, 'x'));
    warnEvent('address-change-check-failed', new Error('Barbaros Blv. 41.0431'));

    expect(warn.mock.calls).toEqual([
      [
        '[getir] address-change-check-failed',
        { code: ERROR_CODES.SERVICE_UNAVAILABLE, requestId: 'req_1' },
      ],
      ['[getir] address-change-check-failed', { code: ERROR_CODES.INTERNAL }],
      ['[getir] address-change-check-failed', { code: 'UNKNOWN' }],
    ]);
  });
});

describe('kayit gecerli adresi kendiliginden tasir mi', () => {
  const book: SavedAddress[] = [
    { id: 'adr_1', title: 'Ev', kind: 'HOME', line: 'Moda Cad. No:12', location: EV },
    { id: 'adr_2', title: 'İş', kind: 'WORK', line: 'Barbaros Blv. No:40', location: EV },
  ];
  const delivery = (selection: StoredSelection | null, addresses = book) =>
    resolveDeliveryAddress({ session: 'authenticated', userId: 'usr_1', addresses, selection });
  const moved = { lat: EV.lat + 0.01, lng: EV.lng };

  it('duzenleme (S2 a): yalniz gecerli adresin KONUMU degisince', () => {
    const chosen = delivery({ userId: 'usr_1', addressId: 'adr_2' });

    expect(
      editMovesDelivery({ delivery: chosen, editedId: 'adr_2', before: EV, after: moved }),
    ).toBe(true);
    expect(editMovesDelivery({ delivery: chosen, editedId: 'adr_2', before: EV, after: EV })).toBe(
      false,
    );
    expect(
      editMovesDelivery({ delivery: chosen, editedId: 'adr_1', before: EV, after: moved }),
    ).toBe(false);
  });

  it('duzenleme: secim yoksa ya da baska hesabinsa ust barda gorunen ILK adres gecerlidir', () => {
    for (const selection of [null, { userId: 'usr_baska', addressId: 'adr_2' }]) {
      const fallback = delivery(selection);

      expect(
        editMovesDelivery({ delivery: fallback, editedId: 'adr_1', before: EV, after: moved }),
      ).toBe(true);
      expect(
        editMovesDelivery({ delivery: fallback, editedId: 'adr_2', before: EV, after: moved }),
      ).toBe(false);
    }
  });

  it('ekleme: defter bos ya da okunamadiysa yeni adres kendiliginden gecerli olur (soru once)', () => {
    expect(addMovesDelivery(delivery(null, []))).toBe(true);
    expect(
      addMovesDelivery(
        resolveDeliveryAddress({
          session: 'authenticated',
          userId: 'usr_1',
          addresses: 'error',
          selection: null,
        }),
      ),
    ).toBe(true);
    expect(addMovesDelivery(delivery(null))).toBe(false);
  });

  it('oturumsuz varsayilan ve bekleme: duzenleme sormaz; bekleme eklemede de sormaz', () => {
    const anonymous = resolveDeliveryAddress({
      session: 'anonymous',
      userId: null,
      addresses: book,
      selection: null,
    });
    const pending = resolveDeliveryAddress({
      session: 'unknown',
      userId: null,
      addresses: 'loading',
      selection: null,
    });

    for (const state of [anonymous, pending]) {
      expect(
        editMovesDelivery({ delivery: state, editedId: 'adr_1', before: EV, after: moved }),
      ).toBe(false);
    }
    expect(addMovesDelivery(pending)).toBe(false);
  });
});

describe('bekci baglami', () => {
  it('saglayici yoksa sorulmaz: sepete dokunmayan izin (karsilama, test)', async () => {
    let guard: AddressChangeGuard | undefined;
    function Probe() {
      guard = useAddressChangeGuard();
      return null;
    }
    renderToStaticMarkup(createElement(Probe));

    await expect(guard?.(EV)).resolves.toBe(KEEP_CART);
  });
});

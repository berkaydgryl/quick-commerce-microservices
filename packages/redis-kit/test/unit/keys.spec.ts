import {
  AppError,
  ERROR_CODES,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  courierLastKey,
  courierTrackKey,
  emailVerificationKey,
  EVENTS_DEAD_LETTER_STREAM_KEY,
  EVENTS_STREAM_KEY,
  hashTag,
  hashTagOf,
  IDEMPOTENCY_ANONYMOUS_SCOPE,
  idempotencyKey,
  rateLimitKey,
  realtimeSeqKey,
  RECONCILE_LOCK_KEY,
  reservationIndexKey,
  reservationKey,
  sameHashTag,
  STOCK_SEEDED_MARKER_KEY,
  stockAvailKey,
  userReservationKey,
} from '../../src/keys.js';

const STORE = 'ds_kadikoy';
const SKU = 'SUT-1L';
const ORDER_ID = 'ord_1';
/** Hiz sinirinin kullanici oznesi: core'daki kimlik bicimi (usr_ + 32 hex). */
const USER_ID = 'usr_0123456789abcdef0123456789abcdef';

describe('anahtar bicimleri', () => {
  it('roadmap tablosundaki bicimleri birebir uretir', () => {
    expect(stockAvailKey(STORE, SKU)).toBe('stock:{ds_kadikoy}:avail:SUT-1L');
    expect(reservationKey(STORE, ORDER_ID)).toBe('resv:{ds_kadikoy}:ord_1');
    expect(reservationIndexKey(STORE)).toBe('resv:index:{ds_kadikoy}');
    expect(userReservationKey('usr_7')).toBe('resv:user:{usr_7}');
    expect(courierTrackKey('crr_2')).toBe('courier:{crr_2}:track');
    expect(courierLastKey('crr_2')).toBe('courier:{crr_2}:last');
    expect(idempotencyKey('usr_7', '4f1c3a2b-9d8e')).toBe('idem:{usr_7}:4f1c3a2b-9d8e');
    expect(idempotencyKey(IDEMPOTENCY_ANONYMOUS_SCOPE, '4f1c3a2b-9d8e')).toBe(
      'idem:{anon}:4f1c3a2b-9d8e',
    );
    expect(rateLimitKey('10.0.0.1', 'POST_/v1/orders')).toBe('rate:{10.0.0.1}:POST_/v1/orders');
    expect(rateLimitKey(USER_ID, 'POST_/v1/orders/id/3ds')).toBe(
      `rate:{${USER_ID}}:POST_/v1/orders/id/3ds`,
    );
    expect(rateLimitKey('::1', 'POST_/v1/auth/login')).toBe('rate:{::1}:POST_/v1/auth/login');
    expect(EVENTS_STREAM_KEY).toBe('stream:events');
    expect(EVENTS_DEAD_LETTER_STREAM_KEY).toBe('stream:events:dead');
    expect(RECONCILE_LOCK_KEY).toBe('lock:reconcile');
    // Sayac kumesinin isareti (ADR-17): market basina degil, tek ve hash-tag'siz.
    expect(STOCK_SEEDED_MARKER_KEY).toBe('stock:seeded');
    expect(hashTagOf(STOCK_SEEDED_MARKER_KEY)).toBeUndefined();
    expect(emailVerificationKey(USER_ID)).toBe(`verify:email:{${USER_ID}}`);
  });

  it('bir depoya ait tum anahtarlar ayni hash-tag altindadir', () => {
    // Rezervasyon Lua script'inin tek atomik adimda calisabilmesinin sarti bu.
    const keys = [
      stockAvailKey(STORE, SKU),
      stockAvailKey(STORE, 'EKMEK-1'),
      reservationKey(STORE, ORDER_ID),
      reservationIndexKey(STORE),
    ];

    expect(sameHashTag(keys)).toBe(true);
    expect(keys.every((key) => hashTagOf(key) === STORE)).toBe(true);
  });

  it('farkli depolarin anahtarlari ayni slota dusmez', () => {
    expect(sameHashTag([stockAvailKey(STORE, SKU), stockAvailKey('ds_besiktas', SKU)])).toBe(false);
  });

  it('kullanici anahtari store hash-tagini PAYLASMAZ (bilinen sinir)', () => {
    // reserve.lua hem stok hem kullanici anahtarina dokunuyor (B22). Tek dugumde
    // sorun degil; Cluster'a gecilirse CROSSSLOT verir. Test bu gercegi sabitler.
    expect(sameHashTag([stockAvailKey(STORE, SKU), userReservationKey('usr_7')])).toBe(false);
  });
});

describe('hashTagOf', () => {
  it('ilk suslu parantez ciftini okur', () => {
    expect(hashTagOf('stock:{ds_1}:avail:{SKU}')).toBe('ds_1');
    expect(hashTag('ds_1')).toBe('{ds_1}');
  });

  it('parantez yoksa ya da bossa undefined doner', () => {
    expect(hashTagOf('stream:events')).toBeUndefined();
    expect(hashTagOf('bos:{}:tag')).toBeUndefined();
    expect(hashTagOf('kapanmamis:{ds_1')).toBeUndefined();
  });

  it('tek anahtar her zaman ayni slottadir', () => {
    expect(sameHashTag([])).toBe(true);
    expect(sameHashTag(['stream:events'])).toBe(true);
  });
});

describe('dogrulama', () => {
  it('ayirici karakter tasiyan parcayi reddeder', () => {
    // ':' ve '{}' anahtar duzenini bozar; sessizce kabul edilirse yanlis
    // anahtar yazilir ve stok baska bir slotta aranir.
    expect(() => stockAvailKey('ds:kotu', SKU)).toThrow(AppError);
    expect(() => stockAvailKey('ds{1}', SKU)).toThrow(AppError);
    expect(() => reservationKey(STORE, 'ord 1')).toThrow(AppError);
  });

  it('gecersiz sku reddedilir', () => {
    expect(() => stockAvailKey(STORE, 'sut 1l')).toThrow(AppError);
    expect(() => stockAvailKey(STORE, 'AB')).toThrow(AppError);
  });

  it('hata VALIDATION_FAILED kodunu ve alan adini tasir', () => {
    try {
      rateLimitKey('10.0.0.1', 'POST /v1/orders');
      expect.unreachable('bosluk iceren yol kabul edilmemeliydi');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect((error as AppError).details).toMatchObject({ field: 'route' });
    }
  });

  it('IPv6 adresi kabul edilir', () => {
    expect(rateLimitKey('::1', 'GET_/v1/products')).toBe('rate:{::1}:GET_/v1/products');
  });

  it('hiz sinirinin oznesi IP ya da kullanici kimligidir; baska deger reddedilir (T8.2)', () => {
    for (const subject of [
      'usr_7',
      'ord_0123456789abcdef0123456789abcdef',
      'kotu:ozne',
      '{1}',
      '',
    ]) {
      try {
        rateLimitKey(subject, 'GET_/v1/me');
        expect.unreachable(`${subject} kabul edilmemeliydi`);
      } catch (error: unknown) {
        expect((error as AppError).details).toMatchObject({ field: 'subject' });
      }
    }
  });

  it('cok kisa idempotency anahtari reddedilir', () => {
    expect(() => idempotencyKey('usr_7', 'kisa')).toThrow(AppError);
  });

  it('idempotency anahtari sozlesmedeki uzunluk sinirlarini birebir uygular', () => {
    // Sinirlar @getir/core'dan gelir; REST basligi ayni degerleri kullanir. Sinirin
    // iki yani da denenir: sozlesmenin kabul ettigi anahtar Redis'te reddedilmemeli.
    const ofLength = (length: number): string => 'a'.repeat(length);

    expect(() => idempotencyKey('usr_7', ofLength(IDEMPOTENCY_KEY_MIN_LENGTH - 1))).toThrow(
      AppError,
    );
    expect(idempotencyKey('usr_7', ofLength(IDEMPOTENCY_KEY_MIN_LENGTH))).toBe(
      `idem:{usr_7}:${ofLength(IDEMPOTENCY_KEY_MIN_LENGTH)}`,
    );
    expect(idempotencyKey('usr_7', ofLength(IDEMPOTENCY_KEY_MAX_LENGTH))).toBe(
      `idem:{usr_7}:${ofLength(IDEMPOTENCY_KEY_MAX_LENGTH)}`,
    );
    expect(() => idempotencyKey('usr_7', ofLength(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toThrow(
      AppError,
    );
  });

  it('idempotency anahtarinda ayirici karakter reddedilir', () => {
    expect(() => idempotencyKey('usr_7', 'anahtar:{ds_1}')).toThrow(AppError);
    // Kapsam da anahtar parcasidir: ayirici tasiyamaz.
    expect(() => idempotencyKey('usr:7', 'anahtar-0001')).toThrow(AppError);
  });
});

describe('emailVerificationKey (T11.14)', () => {
  it('kullanici kimligini hash-tag icinde tasir', () => {
    expect(emailVerificationKey(USER_ID)).toBe(`verify:email:{${USER_ID}}`);
    expect(hashTagOf(emailVerificationKey(USER_ID))).toBe(USER_ID);
  });

  it.each(['usr_7', 'ord_0123456789abcdef0123456789abcdef', 'usr_{x}', ''])(
    'kullanici kimligi olmayan parcayi (%j) reddeder',
    (value) => {
      expect(() => emailVerificationKey(value)).toThrow(AppError);
    },
  );
});

describe('realtimeSeqKey (T12.3)', () => {
  const ORDER = 'ord_0123456789abcdef0123456789abcdef';

  it('siparis kimligini hash-tag icinde tasir', () => {
    expect(realtimeSeqKey(ORDER)).toBe(`realtime:{${ORDER}}:seq`);
    expect(hashTagOf(realtimeSeqKey(ORDER))).toBe(ORDER);
  });

  it.each(['ord_1', 'usr_0123456789abcdef0123456789abcdef', 'ord_{x}', ''])(
    'siparis kimligi olmayan parcayi (%j) reddeder',
    (value) => {
      expect(() => realtimeSeqKey(value)).toThrow(AppError);
    },
  );
});

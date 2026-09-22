import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  courierLastKey,
  courierTrackKey,
  EVENTS_STREAM_KEY,
  hashTag,
  hashTagOf,
  idempotencyKey,
  rateLimitKey,
  RECONCILE_LOCK_KEY,
  reservationIndexKey,
  reservationKey,
  sameHashTag,
  stockAvailKey,
  userReservationKey,
} from '../../src/keys.js';

const STORE = 'ds_kadikoy';
const SKU = 'SUT-1L';
const ORDER_ID = 'ord_1';

describe('anahtar bicimleri', () => {
  it('roadmap tablosundaki bicimleri birebir uretir', () => {
    expect(stockAvailKey(STORE, SKU)).toBe('stock:{ds_kadikoy}:avail:SUT-1L');
    expect(reservationKey(STORE, ORDER_ID)).toBe('resv:{ds_kadikoy}:ord_1');
    expect(reservationIndexKey(STORE)).toBe('resv:index:{ds_kadikoy}');
    expect(userReservationKey('usr_7')).toBe('resv:user:{usr_7}');
    expect(courierTrackKey('crr_2')).toBe('courier:{crr_2}:track');
    expect(courierLastKey('crr_2')).toBe('courier:{crr_2}:last');
    expect(idempotencyKey('4f1c3a2b-9d8e')).toBe('idem:{4f1c3a2b-9d8e}');
    expect(rateLimitKey('10.0.0.1', 'POST_/v1/orders')).toBe('rate:{10.0.0.1}:POST_/v1/orders');
    expect(EVENTS_STREAM_KEY).toBe('stream:events');
    expect(RECONCILE_LOCK_KEY).toBe('lock:reconcile');
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

  it('cok kisa idempotency anahtari reddedilir', () => {
    expect(() => idempotencyKey('kisa')).toThrow(AppError);
  });
});

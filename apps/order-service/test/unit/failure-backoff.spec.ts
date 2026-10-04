/** Siparis basina geri cekilme (D3, T13.2): bekleme suresi, ilk hata, silme ve temizlik. */

import { describe, expect, it } from 'vitest';

import { FailureBackoff } from '../../src/application/failure-backoff.js';
import {
  COURIER_FAILURE_BACKOFF_INITIAL_MS,
  COURIER_FAILURE_BACKOFF_MAX_MS,
} from '../../src/config/constants.js';

const T0 = 1_760_000_000_000;
const at = (ms: number) => new Date(T0 + ms);
const production = () =>
  new FailureBackoff({
    initialMs: COURIER_FAILURE_BACKOFF_INITIAL_MS,
    maxMs: COURIER_FAILURE_BACKOFF_MAX_MS,
  });

describe('FailureBackoff', () => {
  it('uretim ayari: 1 sn, 2 sn, 4 sn ... ikiye katlanir, en cok 5 dk', () => {
    const backoff = production();
    const delays: number[] = [];
    for (let failure = 0; failure < 11; failure += 1) {
      delays.push((backoff.failed('ord_1', at(0)).retryAt.getTime() - T0) / 1_000);
    }

    expect(delays).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300]);
  });

  it('yalnizca ilk hata "ilk"; deneme anina kadar bekler, an gelince bekleme biter', () => {
    const backoff = production();

    const first = backoff.failed('ord_1', at(0));
    expect(first).toEqual({ first: true, failures: 1, retryAt: at(1_000) });
    expect(backoff.isWaiting('ord_1', at(999))).toBe(true);
    expect(backoff.isWaiting('ord_1', at(1_000))).toBe(false);
    expect(backoff.isWaiting('ord_2', at(0))).toBe(false);
    expect(backoff.failed('ord_1', at(1_000))).toEqual({
      first: false,
      failures: 2,
      retryAt: at(3_000),
    });
  });

  it('basari kaydi siler: sonraki hata yine ilk ve 1 sn', () => {
    const backoff = production();
    backoff.failed('ord_1', at(0));
    backoff.failed('ord_1', at(1_000));

    backoff.succeeded('ord_1');

    expect(backoff.size).toBe(0);
    expect(backoff.failed('ord_1', at(5_000))).toEqual({
      first: true,
      failures: 1,
      retryAt: at(6_000),
    });
  });

  it('temizlik: deneme ani en uzun beklemeden de eski kayit silinir, digerleri kalir', () => {
    const backoff = new FailureBackoff({ initialMs: 1_000, maxMs: 10_000 });
    backoff.failed('ord_eski', at(0)); // deneme ani +1 sn
    backoff.failed('ord_yeni', at(9_000)); // deneme ani +10 sn

    backoff.prune(at(11_000)); // sinir: 11 - 10 = 1 sn; 1 sn eski degil
    expect(backoff.size).toBe(2);
    backoff.prune(at(11_001));

    expect(backoff.size).toBe(1);
    expect(backoff.isWaiting('ord_yeni', at(9_500))).toBe(true);
  });
});

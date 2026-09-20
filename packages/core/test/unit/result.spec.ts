import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, map, mapErr, ok, unwrapOr } from '../../src/index.js';
import type { Result } from '../../src/index.js';

const SAMPLE_VALUE = 42;
const FALLBACK_VALUE = -1;

/**
 * Birlesimi koruyan yardimci: `const r: Result<number, string> = ok(1)` yazilirsa
 * TypeScript degiskeni atama uzerinden `Ok<number>`'a daraltir ve hata tarafi
 * `never` olur. Gercek kullanimda Result bir fonksiyon donusudur ve daralma
 * olmaz; testin bu durumu taklit etmesi icin donusu buradan aliyoruz.
 */
const asResult = <T, E>(result: Result<T, E>): Result<T, E> => result;

describe('Result', () => {
  it('ok basarili sonuc uretir', () => {
    const result = ok(SAMPLE_VALUE);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(SAMPLE_VALUE);
  });

  it('err basarisiz sonuc uretir', () => {
    const result = err('bozuk');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('bozuk');
  });

  it('isOk / isErr tipi daraltir', () => {
    const result: Result<number, string> = ok(SAMPLE_VALUE);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);

    if (isOk(result)) {
      // Daraltma calismazsa bu satir derlenmez.
      expect(result.value + 1).toBe(SAMPLE_VALUE + 1);
    }

    const failure = asResult<number, string>(err('bozuk'));
    expect(isErr(failure)).toBe(true);
    if (isErr(failure)) {
      expect(failure.error.length).toBeGreaterThan(0);
    }
  });

  it('unwrapOr hata durumunda varsayilani dondurur', () => {
    expect(unwrapOr(ok(SAMPLE_VALUE), FALLBACK_VALUE)).toBe(SAMPLE_VALUE);
    expect(unwrapOr(err<string>('bozuk'), FALLBACK_VALUE)).toBe(FALLBACK_VALUE);
  });

  it('map sadece basari degerini donusturur', () => {
    const mapped = map(ok(SAMPLE_VALUE), (value) => value * 2);
    expect(mapped).toEqual({ ok: true, value: SAMPLE_VALUE * 2 });

    const failure = asResult<number, string>(err('bozuk'));
    const untouched = map(failure, (value) => value * 2);
    expect(untouched).toEqual({ ok: false, error: 'bozuk' });
  });

  it('mapErr sadece hata degerini donusturur', () => {
    const mapped = mapErr(err('bozuk'), (error) => error.toUpperCase());
    expect(mapped).toEqual({ ok: false, error: 'BOZUK' });

    const success = asResult<number, string>(ok(SAMPLE_VALUE));
    const untouched = mapErr(success, (error) => error.toUpperCase());
    expect(untouched).toEqual({ ok: true, value: SAMPLE_VALUE });
  });

  it('saf kalir: kaynak sonucu degistirmez', () => {
    const source = ok(SAMPLE_VALUE);
    map(source, (value) => value * 2);
    expect(source).toEqual({ ok: true, value: SAMPLE_VALUE });
  });
});

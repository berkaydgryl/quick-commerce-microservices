/**
 * Son kullanma yili secenekleri (T11.17 web, QA C9): Turkiye saatiyle bu yil
 * ve CARD_EXPIRY_MAX_YEARS_AHEAD yil ilerisi; kasanin kuraliyla ayni takvim.
 * Web'in numara sinirlamasi sozlesmenin marka uzunluklarindan (BRAND_LENGTHS).
 */

import { describe, expect, it } from 'vitest';

import {
  BRAND_LENGTHS,
  CARD_EXPIRY_MAX_YEARS_AHEAD,
  cardExpiryProblem,
  cardExpiryYears,
} from '../../src/index.js';

describe('cardExpiryYears (T11.17)', () => {
  it('bu yildan CARD_EXPIRY_MAX_YEARS_AHEAD yil ileriye, artan', () => {
    const years = cardExpiryYears(new Date('2026-10-06T12:00:00.000Z'));

    expect(years[0]).toBe(2026);
    expect(years).toHaveLength(CARD_EXPIRY_MAX_YEARS_AHEAD + 1);
    expect(years.at(-1)).toBe(2026 + CARD_EXPIRY_MAX_YEARS_AHEAD);
  });

  it('yil Turkiye saatiyle doner: 31 Aralik 22:00 UTC zaten yeni yil', () => {
    expect(cardExpiryYears(new Date('2026-12-31T22:00:00.000Z'))[0]).toBe(2027);
    expect(cardExpiryYears(new Date('2026-12-31T20:00:00.000Z'))[0]).toBe(2026);
  });

  it('secenekler kasanin kuralindan gecer: ilk yilin son ayi ve son yil gecerli, bir sonraki yil degil', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    const years = cardExpiryYears(now);
    const last = years.at(-1) ?? 0;

    expect(cardExpiryProblem(12, years[0] ?? 0, now)).toBeNull();
    expect(cardExpiryProblem(1, last, now)).toBeNull();
    expect(cardExpiryProblem(1, last + 1, now)).not.toBeNull();
  });

  it('marka uzunluklari disa acik: Amex 15, Visa en fazla 19', () => {
    expect(Math.max(...BRAND_LENGTHS.AMEX)).toBe(15);
    expect(Math.max(...BRAND_LENGTHS.VISA)).toBe(19);
  });
});

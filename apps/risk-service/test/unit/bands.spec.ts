/** Bant esikleri TAM KENARLARINDA: 29/30, 54/55, 79/80 (T6.1 karari). */

import { RISK_BANDS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { bandForScore } from '../../src/domain/bands.js';

describe('bandForScore', () => {
  it.each([
    [0, RISK_BANDS.LOW],
    [29, RISK_BANDS.LOW],
    [30, RISK_BANDS.MEDIUM],
    [54, RISK_BANDS.MEDIUM],
    [55, RISK_BANDS.HIGH],
    [79, RISK_BANDS.HIGH],
    [80, RISK_BANDS.CRITICAL],
    [100, RISK_BANDS.CRITICAL],
  ])('skor %i -> %s', (score, band) => {
    expect(bandForScore(score)).toBe(band);
  });
});

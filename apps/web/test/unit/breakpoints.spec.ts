import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BREAKPOINTS_REM, mediaQuery } from '../../src/shared/config/breakpoints';

/**
 * Kirilimlar iki yerde yasar: CSS icin breakpoints.css (@custom-media), JS icin
 * breakpoints.ts (matchMedia). Bu test ikisinin ayrismasini yakalar (roadmap P6).
 */
const css = readFileSync(
  new URL('../../src/shared/styles/breakpoints.css', import.meta.url),
  'utf8',
);

function customMediaInCss(): Record<string, number> {
  const pattern = /@custom-media\s+--bp-([a-z]+)\s+\(min-width:\s*([\d.]+)rem\)/g;
  const found: Record<string, number> = {};
  for (const [, name, rem] of css.matchAll(pattern)) {
    if (name !== undefined && rem !== undefined) {
      found[name] = Number(rem);
    }
  }
  return found;
}

describe('kirilim noktalari', () => {
  it('CSS ve JS ayni kirilimlari ayni rem degerleriyle tanimlar', () => {
    expect(customMediaInCss()).toEqual(BREAKPOINTS_REM);
  });

  it('matchMedia sorgusu rem ile kurulur', () => {
    expect(mediaQuery('md')).toBe('(min-width: 48rem)');
    expect(mediaQuery('lg')).toBe('(min-width: 64rem)');
  });
});

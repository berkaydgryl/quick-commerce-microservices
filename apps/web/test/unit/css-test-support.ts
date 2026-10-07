/**
 * CSS kaynagini okuyan testlerin ortak yardimcilari: kurallar CSS'te yasar (degisken
 * kalitimi, kirilim), testler bildirimlerin yerinde kaldigini denetler; olcum canli turda.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect } from 'vitest';

/** src/ altindaki bir CSS dosyasinin metni. */
export const css = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), 'utf8');

/** Bir secicinin ilk kural blogunun icerigi (bulunamazsa test duser). */
export function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} bulunamadi`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start));
}

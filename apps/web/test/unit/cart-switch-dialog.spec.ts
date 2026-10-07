/**
 * Baska market uyarisi (T6.4; T16.3 duzeltmesi, kullanici istegi): satir ici
 * kutu yerine ekranin ORTASINDA pencere. "Sepeti boşalt" penceresinin kabugu
 * (ortak Dialog: karartma, odak pencerede, Esc ve X = Vazgeç) ve govdesi
 * (ConfirmPanel): soru ve dugmeler T6.4'tekiyle ayni, "Evet" mor. Sepete
 * ekleyen her giris noktasi (useAddToCart kullanan her dosya) AYNI pencereyi
 * cizer; satir ici kutu geri gelmez. Pencerenin isaretlemesi F13'ten beri
 * ortak onay penceresinin testinde (onay-penceresi.spec).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => join(SRC, path));
}

describe('CartSwitchDialog (T16.3 duzeltmesi; F13 ortak onay penceresi)', () => {
  it('satir ici kutu yok: hicbir kaynakta c-cart-switch ve CartSwitchPrompt kalmadi', () => {
    const leftovers = sourceFiles().filter((file) =>
      /c-cart-switch|CartSwitchPrompt/.test(readFileSync(file, 'utf8')),
    );

    expect(leftovers.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('tek yerden: useAddToCart kullanan her dosya CartSwitchDialog cizer', () => {
    const consumers = sourceFiles().filter(
      (file) =>
        !file.endsWith('useAddToCart.ts') && /useAddToCart\(/.test(readFileSync(file, 'utf8')),
    );

    expect(consumers.length).toBeGreaterThanOrEqual(2);
    for (const file of consumers) {
      expect(readFileSync(file, 'utf8'), relative(SRC, file)).toContain('<CartSwitchDialog');
    }
  });
});

/**
 * Token dosyalari (F22; tokens.css 300 satir sinirindaydi): renk, yazi,
 * bosluk, kenar, hareket ve katman tokens.css'te; duzen ve bilesen olculeri
 * layout/tokens.css'te; odeme karti payment-card/tokens.css'te. Her token TEK
 * dosyada tanimli (kopya yok), her dosya 300 satirin altinda, uygulama hepsini
 * sirasiyla yukler.
 */

import { describe, expect, it } from 'vitest';

import { css, TOKEN_FILES } from './css-test-support';

const declared = (source: string): string[] =>
  [...source.matchAll(/^\s*(--[\w-]+):/gm)].map(([, name]) => name ?? '');

describe('token dosyalari', () => {
  it('her token tek dosyada tanimli (kopya yok)', () => {
    const names = TOKEN_FILES.flatMap((file) => declared(css(file)));
    const copies = names.filter((name, index) => names.indexOf(name) !== index);

    expect(names.length).toBeGreaterThan(100);
    expect(copies).toEqual([]);
  });

  it('her dosya 300 satirin altinda (proje kurali)', () => {
    for (const file of TOKEN_FILES) {
      expect(css(file).split('\n').length, file).toBeLessThanOrEqual(300);
    }
  });

  it("uygulama token dosyalarini sirasiyla, global.css'ten once yukler", () => {
    const main = css('main.tsx');
    const order = [...TOKEN_FILES, 'shared/styles/global.css'].map((file) =>
      main.indexOf(`import './${file}';`),
    );

    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("duzen olculeri layout/tokens.css'te (ornek: urun karti, hesap duzeni)", () => {
    const layout = declared(css('shared/styles/layout/tokens.css'));

    expect(layout).toEqual(
      expect.arrayContaining([
        '--size-product-card-min',
        '--size-account-content',
        '--container-max-sm',
      ]),
    );
    expect(declared(css('shared/styles/tokens.css'))).not.toContain('--size-product-card-min');
  });
});

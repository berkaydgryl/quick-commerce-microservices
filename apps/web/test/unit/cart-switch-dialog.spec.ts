/**
 * Baska market uyarisi (T6.4; T16.3 duzeltmesi, kullanici istegi): satir ici
 * kutu yerine ekranin ORTASINDA pencere. "Sepeti boşalt" penceresinin kabugu
 * (ortak Dialog: karartma, odak pencerede, Esc ve X = Vazgeç) ve govdesi
 * (ConfirmPanel): soru ve dugmeler T6.4'tekiyle ayni, "Evet" mor. Sepete
 * ekleyen her giris noktasi (useAddToCart kullanan her dosya) AYNI pencereyi
 * cizer; satir ici kutu geri gelmez. ConfirmPanel'in yeni ozellikleri istege
 * bagli: diger pencerelerin isaretlemesi degismez.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Product } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CartSwitchDialog } from '../../src/features/cart/ui/CartSwitchDialog';
import { ClearCartDialog } from '../../src/features/cart/ui/ClearCartDialog';
import { ConfirmPanel } from '../../src/shared/ui/confirm-panel/ConfirmPanel';

const TEXTS = CONTENT_FALLBACK.marketList.cart;
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const noop = () => undefined;
const PRODUCT = { name: 'Süt 1 L' } as Product;

const dialog = () =>
  renderToStaticMarkup(
    createElement(CartSwitchDialog, {
      pending: { product: PRODUCT, currentMarket: { id: 'mkt_a101', name: 'A101 – Caferağa' } },
      targetMarketName: 'ŞOK – Moda',
      texts: TEXTS,
      onConfirm: noop,
      onCancel: noop,
    }),
  );

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => join(SRC, path));
}

describe('CartSwitchDialog (T16.3 duzeltmesi)', () => {
  it('ortak pencerede: <dialog>, basliga bagli (aria-labelledby), sagda X "Kapat"', () => {
    const html = dialog();
    const labelledBy = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];

    expect(labelledBy).toBeDefined();
    expect(html).toContain(`<h2 id="${labelledBy ?? ''}"`);
    expect(html).toContain(`>${TEXTS.clearLabel}</h2>`);
    expect(html).toContain(`aria-label="${TEXTS.closeLabel}"`);
  });

  it('soru ve dugmeler T6.4\'tekiyle ayni; "Evet" mor (birincil), not yok', () => {
    const html = dialog();

    expect(html).toContain(
      '>Sepetinde A101 – Caferağa ürünleri var. Sepeti boşaltıp ŞOK – Moda ile devam edilsin mi?</p>',
    );
    expect(html).toMatch(/class="[^"]*c-confirm-panel__confirm--primary[^"]*"[^>]*>Evet<\/button>/);
    expect(html).toContain('>Vazgeç</button>');
    expect(html).not.toContain('c-confirm-panel__hint');
  });

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

describe('ConfirmPanel istege bagli ozellikler (diger pencereler degismez)', () => {
  it('varsayilan: not cizilir, onay kirmizi (primary sinifi yok)', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmPanel, {
        questionSuffix: 'Silinsin mi?',
        hint: 'Geri alinamaz.',
        error: null,
        pending: false,
        confirmLabel: 'Sil',
        pendingLabel: 'Siliniyor…',
        cancelLabel: 'Vazgeç',
        onConfirm: noop,
        onCancel: noop,
      }),
    );

    expect(html).toContain('>Geri alinamaz.</p>');
    expect(html).not.toContain('--primary');
  });

  it('"Sepeti boşalt" penceresi: not var, "Boşalt" kirmizi kaldi', () => {
    const html = renderToStaticMarkup(
      createElement(ClearCartDialog, { texts: TEXTS, onConfirm: noop, onCancel: noop }),
    );

    expect(html).toContain(TEXTS.clearConfirmHint);
    expect(html).not.toContain('--primary');
  });
});

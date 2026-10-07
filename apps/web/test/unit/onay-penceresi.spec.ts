/**
 * Ortak onay penceresi (F13; 07.10 kullanici istegi, referans #57): butun silme
 * onaylari (sepeti bosalt/temizle, karti sil, adresi sil, odemede karti sil) ve
 * market degistirme ayni pencere: <dialog> onay turu (baslik satiri ve X yok),
 * ortada tek soru, solda "Hayır", sagda "Evet"; pencerenin adi soru. Mesaj
 * silinen seye gore icerikten. Karartma iptaldir (yalniz onay turunde, islem
 * surerken degil); ic pencerenin olaylari dis pencereyi kapatmaz.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Product, SavedAddress } from '@getir/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DeleteAddressDialog } from '../../src/features/address/ui/DeleteAddressDialog';
import { CartSwitchDialog } from '../../src/features/cart/ui/CartSwitchDialog';
import { ClearCartDialog } from '../../src/features/cart/ui/ClearCartDialog';
import { DeleteCardDialog } from '../../src/features/cards/ui/DeleteCardDialog';
import { ConfirmPanel } from '../../src/shared/ui/confirm-panel/ConfirmPanel';
import { backdropAction, isOwnEvent } from '../../src/shared/ui/dialog/dialog-events';

import { VISA_CARD } from './card-test-support';

const CART = CONTENT_FALLBACK.marketList.cart;
const ADDRESSES = CONTENT_FALLBACK.addresses;
const CARDS = CONTENT_FALLBACK.paymentMethods;
const noop = () => undefined;
const HOME = {
  id: 'adr_00000000000000000000000000000001',
  kind: 'HOME',
  title: 'Ev',
  line: 'Moda Cad. No:12',
  location: { lat: 40.98, lng: 29.02 },
} as unknown as SavedAddress;
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');

const render = (node: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node));

/** Metindeki iki parcanin sirasi. */
const before = (html: string, first: string, second: string) =>
  html.indexOf(first) >= 0 && html.indexOf(first) < html.indexOf(second);

describe('gorunum (referans #57)', () => {
  const html = render(
    createElement(ClearCartDialog, {
      question: CART.clearConfirmQuestion,
      onConfirm: noop,
      onCancel: noop,
    }),
  );

  it('onay turu <dialog>: baslik satiri ve X yok; adi soru (aria-labelledby)', () => {
    const id = /<p id="([^"]+)"[^>]*>Sepeti boşaltmak istediğinden emin misin\?<\/p>/.exec(
      html,
    )?.[1];

    expect(html).toMatch(/^<dialog class="[^"]*c-dialog[^"]*c-dialog--confirm/);
    expect(id).toBeDefined();
    expect(html).toMatch(new RegExp(`<dialog[^>]*aria-labelledby="${id}"`));
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('aria-label="Kapat"');
  });

  it('altta solda "Hayır" (beyaz, mor cerceve), sagda "Evet" (dolu mor)', () => {
    expect(before(html, '>Hayır</button>', '>Evet</button>')).toBe(true);
    expect(html).toMatch(/c-confirm-panel__no[^>]*>Hayır</);
    expect(html).toMatch(/c-confirm-panel__yes[^>]*>Evet</);
  });
});

describe('mesaj silinen seye gore (icerikten)', () => {
  it('sepet: panel ve /sepet ayni soru', () => {
    expect(CART.clearConfirmQuestion).toBe('Sepeti boşaltmak istediğinden emin misin?');
  });

  it('kart ve adres: gorunen soru duz (PM S1 (a)); ekran okuyucu hangisi oldugunu duyar (QA K4)', () => {
    const card = render(
      createElement(DeleteCardDialog, {
        texts: CARDS,
        card: VISA_CARD,
        pending: false,
        error: null,
        onConfirm: noop,
        onCancel: noop,
      }),
    );
    const address = render(
      createElement(DeleteAddressDialog, {
        texts: ADDRESSES,
        address: HOME,
        pending: false,
        error: null,
        onConfirm: noop,
        onCancel: noop,
      }),
    );

    expect(card).toMatch(
      /Kartı silmek istediğinden emin misin\?<span class="[^"]*c-confirm-panel__spoken[^"]*"> Visa, son dört hane 4242<\/span><\/p>/,
    );
    expect(address).toMatch(
      /Adresi silmek istediğinden emin misin\?<span class="[^"]*c-confirm-panel__spoken[^"]*"> Ev<\/span><\/p>/,
    );
  });

  it('market degistirme: soru icerikten, hedef marketin adiyla (aramada hangi market belli)', () => {
    const html = render(
      createElement(CartSwitchDialog, {
        pending: {
          product: { name: 'Süt 1 L' } as Product,
          currentMarket: { id: 'mkt_a', name: 'Migros' },
        },
        targetMarketName: 'A101 – Caferağa',
        texts: CART,
        onConfirm: noop,
        onCancel: noop,
      }),
    );

    expect(html).toContain(
      `>${CART.switchConfirmPrefix} A101 – Caferağa ${CART.switchConfirmSuffix}</p>`,
    );
    expect(html).toContain('c-dialog--confirm');
    expect(readFileSync(join(SRC, 'features/cart/ui/CartSwitchDialog.tsx'), 'utf8')).not.toMatch(
      /Sepetinde \$\{|Label="Evet"/,
    );
  });

  it('"Evet" ve "Hayır" ortak icerik grubundan (F13, PM S2 (a))', () => {
    expect(CONTENT_FALLBACK.confirm).toEqual({ yesLabel: 'Evet', noLabel: 'Hayır' });
  });
});

describe('islem ve hata', () => {
  const panel = (pending: boolean, error: string | null) =>
    renderToStaticMarkup(
      createElement(ConfirmPanel, {
        question: 'Soru?',
        error,
        pending,
        yesLabel: 'Evet',
        noLabel: 'Hayır',
        pendingLabel: 'Siliniyor…',
        onConfirm: noop,
        onCancel: noop,
      }),
    );

  it('surerken iki dugme pasif, "Evet" yerine "Siliniyor…" (aria-busy)', () => {
    const html = panel(true, null);

    expect(html).toMatch(/disabled=""[^>]*>Hayır</);
    expect(html).toMatch(/disabled=""[^>]*aria-busy="true"[^>]*>Siliniyor…</);
  });

  it('sunucunun cumlesi pencerede uyari (role=alert)', () => {
    expect(panel(false, 'Ağ hatası')).toContain('role="alert">Ağ hatası</p>');
  });
});

describe('silme surerken (kart ve adres sarmalayicilari)', () => {
  it('"Evet" "Siliniyor…", iki dugme pasif; sunucunun cumlesi pencerede', () => {
    for (const html of [
      render(
        createElement(DeleteCardDialog, {
          texts: CARDS,
          card: VISA_CARD,
          pending: true,
          error: 'Ağ hatası',
          onConfirm: noop,
          onCancel: noop,
        }),
      ),
      render(
        createElement(DeleteAddressDialog, {
          texts: ADDRESSES,
          address: HOME,
          pending: true,
          error: 'Ağ hatası',
          onConfirm: noop,
          onCancel: noop,
        }),
      ),
    ]) {
      expect(html).toMatch(/disabled=""[^>]*>Hayır</);
      expect(html).toMatch(/disabled=""[^>]*aria-busy="true"[^>]*>Siliniyor…</);
      expect(html).toContain('role="alert">Ağ hatası</p>');
    }
  });
});

describe('olaylar (dialog-events)', () => {
  const dialog = {} as EventTarget;
  const inner = {} as EventTarget;

  it('onay turunde karartmaya tiklama iptal; icerige tiklama degil', () => {
    const onAction = vi.fn();

    expect(backdropAction(true, true, dialog, dialog, { label: 'Hayır', onAction })).toBe(onAction);
    expect(
      backdropAction(true, false, inner, dialog, { label: 'Hayır', onAction }),
    ).toBeUndefined();
  });

  it('kutunun icinden baslayip karartmada birakilan surukleme iptal DEGIL', () => {
    const onAction = vi.fn();

    expect(
      backdropAction(true, false, dialog, dialog, { label: 'Hayır', onAction }),
    ).toBeUndefined();
  });

  it('islem surerken (pasif) ve diger pencerelerde karartma bir sey yapmaz', () => {
    const onAction = vi.fn();

    expect(
      backdropAction(true, true, dialog, dialog, { label: 'Hayır', onAction, disabled: true }),
    ).toBeUndefined();
    expect(
      backdropAction(false, true, dialog, dialog, { label: 'Hayır', onAction }),
    ).toBeUndefined();
  });

  it('ic pencerenin (ust uste onay) cancel/close olayi dis pencerenin degil', () => {
    expect(isOwnEvent(dialog, dialog)).toBe(true);
    expect(isOwnEvent(inner, dialog)).toBe(false);
  });
});

describe('tek bilesen: kopya yok', () => {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.tsx$/.test(path))
    .map((path) => join(SRC, path));

  it('ConfirmPanel yalniz ortak pencerede (ConfirmDialog) kullanilir', () => {
    const users = files
      .filter((file) => /import \{ ConfirmPanel \}/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));

    expect(users).toEqual([join('shared', 'ui', 'confirm-panel', 'ConfirmDialog.tsx')]);
  });

  it('bes onay yeri ortak pencereyi cizer', () => {
    for (const path of [
      'features/cart/ui/ClearCartDialog.tsx',
      'features/cart/ui/CartSwitchDialog.tsx',
      'features/address/ui/DeleteAddressDialog.tsx',
      'features/cards/ui/DeleteCardDialog.tsx',
    ]) {
      expect(readFileSync(join(SRC, path), 'utf8'), path).toContain('<ConfirmDialog');
    }
    expect(
      readFileSync(join(SRC, 'features/checkout/ui/PaymentMethodDialog.tsx'), 'utf8'),
    ).toContain('<DeleteCardDialog');
  });
});

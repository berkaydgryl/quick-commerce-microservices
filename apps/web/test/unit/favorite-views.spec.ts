/**
 * Favori gorunumleri (T11.13; referans getircarsi): kalp (durum aria-pressed,
 * adi duruma gore), favori sayfasi (baslik, kartlar, bos durum, yukleniyor,
 * hata) ve bildirim alani. Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { FavoriteButtonView } from '../../src/features/favorites/ui/FavoriteButton';
import { FavoriteMarketsView } from '../../src/pages/account/FavoriteMarketsView';
import type { FavoriteMarketsViewProps } from '../../src/pages/account/FavoriteMarketsView';
import { ToasterView } from '../../src/shared/ui/toast/Toaster';

import { NEARBY } from './market-list-test-support';

const TEXTS = CONTENT_FALLBACK.favorites;
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

describe('FavoriteButtonView', () => {
  it('favori degilken: aria-pressed false, "Favorilere ekle"', () => {
    const markup = render(
      createElement(FavoriteButtonView, {
        favorite: false,
        label: TEXTS.addLabel,
        disabled: false,
        onToggle: () => undefined,
      }),
    );

    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-label="Favorilere ekle"');
    expect(markup).not.toContain('is-active');
  });

  it('favoriyken: aria-pressed true, "Favorilerden çıkar", dolu kalp sinifi', () => {
    const markup = render(
      createElement(FavoriteButtonView, {
        favorite: true,
        label: TEXTS.removeLabel,
        disabled: false,
        onToggle: () => undefined,
      }),
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="Favorilerden çıkar"');
    expect(markup).toContain('is-active');
  });

  it('beyaz kartta (magaza sayfasi, T16.2) yuzey cesidi; varsayilan fotograf ustu', () => {
    const view = (tone: 'photo' | 'surface' | undefined) =>
      render(
        createElement(FavoriteButtonView, {
          favorite: true,
          label: TEXTS.removeLabel,
          disabled: false,
          tone,
          onToggle: () => undefined,
        }),
      );

    expect(view('surface')).toMatch(
      /c-favorite--surface[^"]*is-active|is-active[^"]*c-favorite--surface/,
    );
    expect(view(undefined)).not.toContain('c-favorite--surface');
    expect(view('photo')).not.toContain('c-favorite--surface');
  });
});

describe('FavoriteMarketsView', () => {
  const at = '2026-10-04T09:00:00.000Z';
  const base: FavoriteMarketsViewProps = {
    texts: TEXTS,
    listTexts: CONTENT_FALLBACK.marketList,
    list: { items: NEARBY.slice(0, 3).map((nearby) => ({ market: nearby.market, addedAt: at })) },
    error: null,
    onRetry: () => undefined,
    renderAction: (market) => createElement('button', { type: 'button' }, `KALP-${market.id}`),
  };

  it('baslik h1 "Favori İşletmelerim"; kartlar sirayla, her kartta kalp; kapali market "Kapalı"', () => {
    const markup = render(createElement(FavoriteMarketsView, base));

    expect(markup).toMatch(/<h1[^>]*>Favori İşletmelerim<\/h1>/);
    expect([...markup.matchAll(/href="\/markets\/([^"]+)"/g)].map((match) => match[1])).toEqual([
      'mkt_a101-caferaga',
      'mkt_moda-kasabi',
      'mkt_migros-jet-moda',
    ]);
    expect(markup.match(/KALP-/g)).toHaveLength(3);
    expect(markup.match(/>Kapalı</g)).toHaveLength(1);
    // Odak tasinabilen baslik ve bos duyuru alani (QA W2).
    expect(markup).toMatch(/<h1[^>]*tabindex="-1"/);
    expect(markup).toMatch(/role="status" aria-live="polite"><\/p>/);
  });

  it('bos liste: aciklama; yuklenirken durum satiri; hata mesaji', () => {
    expect(render(createElement(FavoriteMarketsView, { ...base, list: { items: [] } }))).toContain(
      TEXTS.emptyTitle,
    );
    expect(render(createElement(FavoriteMarketsView, { ...base, list: undefined }))).toMatch(
      /role="status"[^>]*>Favorilerin yükleniyor…/,
    );
    expect(
      render(
        createElement(FavoriteMarketsView, {
          ...base,
          list: undefined,
          error: new Error('Favoriler alınamadı'),
        }),
      ),
    ).toContain('Favoriler alınamadı');
  });
});

describe('Toaster', () => {
  it('aria-live bolgesi; her bildirimde kapatma dugmesi (icerikteki adla)', () => {
    const markup = render(
      createElement(ToasterView, {
        toasts: [{ id: 1, message: TEXTS.updateFailedToast }],
        dismissLabel: TEXTS.toastDismissLabel,
        onDismiss: () => undefined,
      }),
    );

    expect(markup).toMatch(/role="status" aria-live="polite"/);
    expect(markup).toContain('Favori güncellenemedi, tekrar dene.');
    expect(markup).toContain('aria-label="Bildirimi kapat"');
  });
});

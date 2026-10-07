/**
 * "Kuryem nerede" penceresi ve yaklasma bildirimi (F22): pencerede kurye adi
 * (kisaltilmis), harita yeri, tahmini varis ve kalan mesafe, teslimat
 * adresi; paket alinmadan, teslimde, yuklenirken ve takip yokken kendi
 * cumleleri. Bildirim: sol ustte X, baslik ve "Konumu gör". Siparis
 * detayinda "Kuryem nerede" yalniz yoldayken basilir. Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CourierApproachNotice } from '../../src/features/tracking/ui/CourierApproachNotice';
import { CourierMapDialog } from '../../src/features/tracking/ui/CourierMapDialog';
import type { CourierMapState } from '../../src/features/tracking/services/map-state';
import { OrderDetailView } from '../../src/pages/account/OrderDetailView';

import { css } from './css-test-support';
import { ORDER } from './order-test-support';
import { DELIVERED, TO_CUSTOMER, TO_MARKET } from './tracking-test-support';

const TEXTS = CONTENT_FALLBACK.courierTracking;
const MAP = CONTENT_FALLBACK.addressSetup.map;
const ADDRESS = 'Caferağa Mah. Moda Cad. No:12, Kadıköy';

const dialog = (state: CourierMapState) =>
  renderToStaticMarkup(
    createElement(CourierMapDialog, {
      texts: TEXTS,
      map: MAP,
      addressLine: ADDRESS,
      state,
      onRetry: () => undefined,
      onClose: () => undefined,
    }),
  );
const plain = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

describe('kurye penceresi (F22)', () => {
  it('yolda: baslik ve X; "Kuryen Mehmet K."; harita yeri; "~8 dk" ve "1,2 km"; adres', () => {
    const html = dialog({ kind: 'ready', tracking: TO_CUSTOMER });
    const text = plain(html);

    expect(html).toMatch(/<h2[^>]*>Kuryem nerede<\/h2>/);
    expect(html).toContain('aria-label="Kapat"');
    expect(text).toContain('|Kuryen|Mehmet K.|');
    expect(text).not.toContain('Kaya');
    expect(html).toMatch(/c-tracking-map-placeholder[^"]*" aria-busy="true"/);
    expect(text).toContain('|Tahmini varış|~8 dk|Kalan mesafe|1,2 km|');
    expect(text).toContain(`|Teslimat adresi|${ADDRESS}|`);
  });

  it('paket alinmadan: "marketten alıyor" cumlesi; sure dakikaya yuvarli', () => {
    const text = plain(dialog({ kind: 'ready', tracking: TO_MARKET }));

    expect(text).toContain(TEXTS.pickupNotice);
    expect(text).toContain('|~10 dk|');
  });

  it('teslimde: "Siparişin teslim edildi."; sure ve mesafe yok', () => {
    const text = plain(dialog({ kind: 'ready', tracking: DELIVERED }));

    expect(text).toContain(TEXTS.deliveredNotice);
    expect(text).not.toContain(TEXTS.etaLabel);
    expect(text).not.toContain(TEXTS.distanceLabel);
  });

  it('yuklenirken ayni boyda kutu ve duyuru; takip yoksa cumle ve "Tekrar dene"', () => {
    expect(dialog({ kind: 'loading' })).toMatch(
      /aria-busy="true"><p[^>]*role="status">Kuryenin konumu yükleniyor…/,
    );
    const missing = dialog({ kind: 'unavailable' });
    expect(missing).toMatch(
      /role="alert"><p>Kuryenin konumu şu an alınamıyor\.<\/p><button type="button"[^>]*>Tekrar dene<\/button>/,
    );
    // Takip yokken de adres gorunur.
    expect(plain(missing)).toContain(ADDRESS);
  });
});

describe('yaklasma bildirimi (F22)', () => {
  it('sol ustte X (erisilebilir ad), baslik ve "Konumu gör"', () => {
    const html = renderToStaticMarkup(
      createElement(CourierApproachNotice, {
        texts: TEXTS,
        onShow: () => undefined,
        onClose: () => undefined,
        onPause: () => undefined,
        onResume: () => undefined,
      }),
    );

    expect(html).toMatch(
      /^<div[^>]*><button type="button"[^>]*aria-label="Bildirimi kapat"[^>]*>.*<\/button><p[^>]*>Kuryen konumuna yaklaştı!<\/p><button type="button"[^>]*>Konumu gör<\/button><\/div>$/,
    );
  });

  it('sag ustte, bildirim katmaninda; hareket azaltmada animasyonsuz', () => {
    const source = css('features/tracking/ui/CourierApproachNotice.module.css');

    expect(source).toMatch(
      /\.c-approach-notice \{[^}]*position: fixed;[^}]*inset-block-start:[^}]*inset-inline-end:[^}]*z-index: var\(--z-toast\);/,
    );
    expect(source).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.c-approach-notice \{\s*animation: none;/,
    );
  });
});

describe('code-review duzeltmeleri (F22)', () => {
  it('ev pimindeki ev cizgisi style ile (SVG ozniteliginde var() her tarayicida calismaz)', () => {
    const markers = css('features/tracking/ui/tracking-markers.ts');

    expect(markers).toContain('style="stroke:var(--text-on-brand)"');
    expect(markers).not.toContain('stroke="var(');
  });

  it("sure ve mesafe 2 sn'de bir okunmaz (canli bolge yok)", () => {
    expect(dialog({ kind: 'ready', tracking: TO_CUSTOMER })).not.toContain('aria-live');
  });

  it('duyuru bolgesi sayfa izgarasinda bosluk acmaz (akis disi); ust barin ustunde (bildirim katmani)', () => {
    expect(css('features/tracking/ui/CourierApproachNotice.module.css')).toMatch(
      /\.c-approach-notice-region \{\s*position: fixed;[^}]*z-index: var\(--z-toast\);/,
    );
  });

  it('harita yer tutucusu kendi blogunda (baska blogun sinifi yok)', () => {
    const lazy = css('features/tracking/ui/LazyTrackingMap.tsx');

    expect(lazy).toContain("import styles from './LazyTrackingMap.module.css';");
    expect(lazy).not.toContain('CourierMapDialog.module.css');
  });

  it('kurye haritasi imlecin oldugu yere yakinlasir; adres haritasi ortadan', () => {
    expect(css('features/tracking/ui/TrackingMap.tsx')).toContain("zoomAround: 'pointer'");
    expect(css('shared/map/base-map.ts')).toContain(
      "const anchor = zoomAround === 'center' ? 'center' : true;",
    );
  });
});

describe('harita isaretleri (F22)', () => {
  it('kurye, market, ev ve rota siniflari tanimli (tanimsiz sinif yazilmaz)', () => {
    const source = css('features/tracking/ui/TrackingMap.module.css');

    for (const name of ['marker', 'marker--courier', 'marker--market', 'marker--home', 'route']) {
      expect(source, name).toContain(`.c-tracking-map__${name} {`);
    }
  });
});

describe('ortak harita: karo dikisi (F22, PM duzeltmesi)', () => {
  it('karolar saydam cerceveyle cizilir; kurulum haritaya sinifi ekler (iki harita da)', () => {
    expect(css('shared/map/BaseMap.module.css')).toMatch(
      /\.c-base-map img \{\s*outline: var\(--border-width-thin\) solid transparent;/,
    );
    expect(css('shared/map/base-map.ts')).toContain("const seamFix = styles['c-base-map'];");
    expect(css('shared/map/base-map.ts')).toContain('element.classList.add(seamFix);');
  });
});

describe('siparis detayinda "Kuryem nerede" (F22)', () => {
  const detail = (status: 'PREPARING' | 'ON_THE_WAY', open?: () => void) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(OrderDetailView, {
          texts: CONTENT_FALLBACK.orders,
          order: { ...ORDER, status },
          marketName: 'Moda Kasabı',
          error: null,
          onRetry: () => undefined,
          listHref: '/hesabim/siparislerim',
          courierButtonId: 'kurye-dugmesi',
          ...(open === undefined ? {} : { onWhereIsCourier: open }),
        }),
      ),
    );

  it('yoldayken ve pencere bagliyken basilir; dugmenin kimligi var (odak donusu)', () => {
    const html = detail('ON_THE_WAY', () => undefined);

    expect(html).toMatch(/<button id="kurye-dugmesi" type="button"[^>]*>Kuryem nerede<\/button>/);
    expect(html).not.toMatch(/disabled=""[^>]*>Kuryem nerede/);
  });

  it('hazirlanirken pasif', () => {
    expect(detail('PREPARING', () => undefined)).toMatch(/disabled=""[^>]*>Kuryem nerede/);
  });
});

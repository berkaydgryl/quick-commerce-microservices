/**
 * Siparis takip cizgisi (F21; 07.10 kullanici karari): durum esleme (13
 * durumun hepsi), adim gorunumu (gecilen, aktif, gelecek; teslimde uc adim
 * sabit), "Kuryem nerede" (yalniz "Kurye yolda" aktifken ve pencere
 * verildiyse), hareket azaltma, detay sayfasindaki yeri ve yoklama (10 sn;
 * teslimde, cizgi disinda ve sekme gizliyken durur). Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { OrderStatus } from '@getir/contracts';
import { environmentManager, focusManager, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../src/app/query-client';
import { orderDetailQuery } from '../../src/features/orders/api/queries';
import { ORDER_TRACK_POLL_MS } from '../../src/features/orders/constants';
import {
  shouldPollOrder,
  trackStep,
  trackStepState,
} from '../../src/features/orders/services/order-track';
import { OrderTrack } from '../../src/features/orders/ui/OrderTrack';
import { OrderDetailView } from '../../src/pages/account/OrderDetailView';
import { createHttpClient } from '../../src/shared/api/http-client';

import { css } from './css-test-support';
import { ORDER, ORDER_ID } from './order-test-support';

const TEXTS = CONTENT_FALLBACK.orders;
const USER = 'usr_00000000000000000000000000000001';

const EXPECTED: Readonly<Record<OrderStatus, string | null>> = {
  DRAFT: null,
  RISK_CHECK: null,
  REVIEW: null,
  RESERVED: null,
  AWAITING_PAYMENT: null,
  PAID: 'preparing',
  PREPARING: 'preparing',
  ON_THE_WAY: 'onTheWay',
  DELIVERED: 'delivered',
  CANCELLED: null,
  REJECTED: null,
  PAYMENT_FAILED: null,
  EXPIRED: null,
};

const track = (status: OrderStatus, onWhereIsCourier?: () => void) =>
  renderToStaticMarkup(
    createElement(OrderTrack, {
      status,
      texts: TEXTS,
      ...(onWhereIsCourier === undefined ? {} : { onWhereIsCourier }),
    }),
  );

/** Adimlar sirayla: durum sinifi, aria-current ve metin. */
const steps = (markup: string) =>
  [
    ...markup.matchAll(
      /<li class="[^"]*is-(done|current|upcoming)[^"]*"( aria-current="step")?>(.*?)<\/li>/g,
    ),
  ].map(([, state, current, inner]) => ({
    state,
    current: current !== undefined,
    text: (inner ?? '').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'),
  }));

describe('durum esleme (F21)', () => {
  it('13 durumun hepsi: hazirlaniyor (PAID, PREPARING), yolda, teslim; gerisi cizgi disi', () => {
    for (const [status, step] of Object.entries(EXPECTED)) {
      expect(trackStep(status as OrderStatus), status).toBe(step);
    }
  });

  it('adim gorunumu: gecilen, aktif, gelecek; teslimde uc adim da gecilmis (sabit, S1 a)', () => {
    expect(trackStepState('preparing', 'preparing')).toBe('current');
    expect(trackStepState('onTheWay', 'preparing')).toBe('upcoming');
    expect(trackStepState('preparing', 'onTheWay')).toBe('done');
    expect(trackStepState('onTheWay', 'onTheWay')).toBe('current');
    expect(trackStepState('delivered', 'onTheWay')).toBe('upcoming');
    expect(trackStepState('delivered', 'delivered')).toBe('done');
  });

  it('yoklama son durumda olmayan her sipariste (inceleme ve odeme bekleyen dahil); son durumlarda yok', () => {
    const polled = Object.keys(EXPECTED).filter((status) => shouldPollOrder(status as OrderStatus));

    expect(polled).toEqual([
      'DRAFT',
      'RISK_CHECK',
      'REVIEW',
      'RESERVED',
      'AWAITING_PAYMENT',
      'PAID',
      'PREPARING',
      'ON_THE_WAY',
    ]);
    expect(shouldPollOrder(undefined)).toBe(false);
  });
});

describe('takip cizgisi (F21)', () => {
  it('hazirlaniyor: ilk adim aktif (aria-current), digerleri bos; gorunur baslik ve sirali liste', () => {
    const markup = track('PREPARING');

    expect(markup).toMatch(
      /<section[^>]*aria-labelledby="([^"]+)"><h2 id="\1"[^>]*>Sipariş durumu<\/h2><ol/,
    );
    expect(markup).not.toContain('clip-path');
    expect(steps(markup)).toEqual([
      { state: 'current', current: true, text: '|Siparişin hazırlanıyor|' },
      { state: 'upcoming', current: false, text: '|Kurye yolda|' },
      { state: 'upcoming', current: false, text: '|Siparişin teslim edildi|' },
    ]);
  });

  it('rayin mor bolumu adima gore: listenin sinifi hazirlaniyor, yolda, teslim', () => {
    const modifier = (status: OrderStatus) =>
      /<ol class="[^"]*c-order-track__steps--([a-z-]+)[^"]*"/.exec(track(status))?.[1];

    expect(modifier('PAID')).toBe('preparing');
    expect(modifier('ON_THE_WAY')).toBe('on-the-way');
    expect(modifier('DELIVERED')).toBe('delivered');
  });

  it('gecilen adimda tik; aktif ve gelecek adimda yok', () => {
    const items = [...track('ON_THE_WAY').matchAll(/<li[^>]*>(.*?)<\/li>/g)].map(
      ([, inner]) => inner ?? '',
    );

    expect(items.map((inner) => inner.includes('<svg'))).toEqual([true, false, false]);
    expect(track('DELIVERED').match(/<svg/g)).toHaveLength(3);
  });

  it('"Kuryem nerede" listenin ALTINDA, ortali satirda (her genislikte "Kurye yolda"nin altinda)', () => {
    expect(track('ON_THE_WAY')).toMatch(
      /<\/ol><div class="[^"]*c-order-track__actions[^"]*"><button type="button"[^>]*>Kuryem nerede<\/button><\/div><\/section>$/,
    );
  });

  it('kurye yolda: ilk adim gecilmis, ikinci aktif', () => {
    expect(steps(track('ON_THE_WAY')).map((step) => [step.state, step.current])).toEqual([
      ['done', false],
      ['current', true],
      ['upcoming', false],
    ]);
  });

  it('teslim edildi: uc adim gecilmis (sabit mor); son adim aria-current', () => {
    expect(steps(track('DELIVERED')).map((step) => [step.state, step.current])).toEqual([
      ['done', false],
      ['done', false],
      ['done', true],
    ]);
  });

  it('cizgi disi durumda hicbir sey cizilmez (odeme oncesi, inceleme, iptal)', () => {
    for (const status of ['REVIEW', 'AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED'] as const) {
      expect(track(status), status).toBe('');
    }
  });

  it('"Kuryem nerede": pencere yokken (F22 oncesi) hazirlanirken ve yoldayken pasif', () => {
    for (const status of ['PAID', 'ON_THE_WAY'] as const) {
      expect(track(status), status).toMatch(
        /<button type="button"[^>]*disabled=""[^>]*>Kuryem nerede</,
      );
    }
  });

  it('"Kuryem nerede": pencere verildiyse YALNIZ "Kurye yolda" aktifken basilir; teslimde yok', () => {
    const open = () => undefined;

    expect(track('ON_THE_WAY', open)).toContain('>Kuryem nerede</button>');
    expect(track('ON_THE_WAY', open)).not.toMatch(/disabled=""[^>]*>Kuryem nerede/);
    expect(track('PREPARING', open)).toMatch(/disabled=""[^>]*>Kuryem nerede/);
    expect(track('DELIVERED', open)).not.toContain('Kuryem nerede');
    expect(track('DELIVERED')).not.toContain('<button');
  });

  it('her adim durumunun CSS kurali var (tanimsiz sinif "undefined" yazilmaz)', () => {
    const source = css('features/orders/ui/OrderTrack.module.css');

    for (const state of ['done', 'current', 'upcoming']) {
      expect(source, state).toContain(`.c-order-track__step.is-${state} `);
    }
    for (const step of ['preparing', 'on-the-way', 'delivered']) {
      expect(source, step).toContain(`.c-order-track__steps--${step}::after {`);
    }
  });

  it('tek ray: esit kolonlar (her genislikte), gri ray 1/6-5/6, mor bolum adima gore 0, 1/3, 2/3', () => {
    const source = css('features/orders/ui/OrderTrack.module.css');

    expect(source).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(source).not.toContain('@media (--bp-');
    expect(source).toMatch(
      /\.c-order-track__steps::before \{[^}]*inset-inline-end: calc\(100% \/ 6\)/,
    );
    expect(source).toMatch(/\.c-order-track__steps--preparing::after \{\s*width: 0;/);
    expect(source).toMatch(
      /\.c-order-track__steps--on-the-way::after \{\s*width: calc\(100% \/ 3\);/,
    );
    expect(source).toMatch(
      /\.c-order-track__steps--delivered::after \{\s*width: calc\(100% \* 2 \/ 3\);/,
    );
  });

  it('yuvarlaklar rayin ustunde ve opak (cizgi yuvarlaga girmez)', () => {
    const source = css('features/orders/ui/OrderTrack.module.css');
    const dot = source.slice(source.indexOf('.c-order-track__dot {'));

    expect(dot).toMatch(
      /^\.c-order-track__dot \{[^}]*z-index: 1;[^}]*background: var\(--bg-surface\);/,
    );
    expect(source).toContain('isolation: isolate');
  });

  it('hazirlanirken pasif dugmenin altinda bilgi satiri (aria-describedby); yoldayken ve teslimde yok', () => {
    const markup = track('PREPARING');
    const id = /<button[^>]*aria-describedby="([^"]+)"[^>]*>Kuryem nerede<\/button>/.exec(
      markup,
    )?.[1];

    expect(TEXTS.whereIsCourierHint).toBe(
      'Kuryen paketi alıp yola çıkınca konumunu buradan canlı izleyebilirsin.',
    );
    expect(id).toBeDefined();
    expect(markup).toContain(`<p id="${id ?? ''}" class="`);
    expect(markup).toMatch(
      /Kuryem nerede<\/button><p id="[^"]+" class="[^"]*c-order-track__hint[^"]*">Kuryen paketi/,
    );
    for (const status of ['ON_THE_WAY', 'DELIVERED'] as const) {
      expect(track(status), status).not.toContain('Kuryen paketi');
      expect(track(status), status).not.toContain('aria-describedby');
    }
  });

  it('aktif adim: hare (hareketsiz de ayirt edilir) ve yanip sonme; hareket azaltmada sabit', () => {
    const source = css('features/orders/ui/OrderTrack.module.css');
    const reducedAt = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const blocks = (text: string) =>
      [...text.matchAll(/\.c-order-track__step\.is-current \.c-order-track__dot \{([^}]*)\}/g)].map(
        ([, body]) => body ?? '',
      );

    expect(reducedAt).toBeGreaterThan(-1);
    expect(
      blocks(source.slice(0, reducedAt)).some(
        (body) => body.includes('box-shadow:') && body.includes('animation: c-order-track-pulse'),
      ),
    ).toBe(true);
    expect(blocks(source.slice(reducedAt))).toEqual([expect.stringContaining('animation: none;')]);
  });
});

describe('siparis detayinda yer (F21)', () => {
  const detail = (status: OrderStatus) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(OrderDetailView, {
          texts: TEXTS,
          order: { ...ORDER, status },
          marketName: 'Moda Kasabı',
          error: null,
          onRetry: () => undefined,
          listHref: '/hesabim/siparislerim',
        }),
      ),
    );

  it('en altta: toplam kartinin altinda (07.10 kullanici istegi)', () => {
    const markup = detail('PREPARING');
    const total = markup.indexOf('500,00 TL');
    const line = markup.indexOf('Sipariş durumu');

    expect(markup.indexOf('Moda Kasabı')).toBeLessThan(total);
    expect(total).toBeGreaterThan(-1);
    expect(total).toBeLessThan(line);
    expect(
      markup.endsWith(
        'Kuryen paketi alıp yola çıkınca konumunu buradan canlı izleyebilirsin.</p></div></section></section>',
      ),
    ).toBe(true);
  });

  it('iptal edilen sipariste cizgi yok; toplam kartinda "Teslimat Ücreti"', () => {
    expect(detail('CANCELLED')).not.toContain('Sipariş durumu');
    expect(detail('DELIVERED').replace(/<[^>]+>/g, '|')).toContain('|Teslimat Ücreti|');
  });
});

describe('detay yoklamasi (F21, PM S3: 10 sn)', () => {
  // Node'da pencere yok: TanStack ortami sunucu sayar ve zamanlayici kurmaz.
  // Tarayicidaki gibi istemci say; test sonunda eski haline don.
  const server = environmentManager.isServer();
  beforeEach(() => environmentManager.setIsServer(() => false));
  afterEach(() => {
    environmentManager.setIsServer(() => server);
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  function observe(status: OrderStatus) {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { ...ORDER, status } })),
        ),
      );
    const http = createHttpClient({ baseUrl: '', fetch: fetchMock });
    const client = createQueryClient();
    const observer = new QueryObserver(client, orderDetailQuery(http, USER, ORDER_ID));
    const unsubscribe = observer.subscribe(() => undefined);
    return { fetchMock, stop: () => (unsubscribe(), client.clear()) };
  }

  it('aralik 10 sn', () => {
    expect(ORDER_TRACK_POLL_MS).toBe(10_000);
  });

  it("suren sipariste (hazirlaniyor) 10 sn'de bir yeniden istenir", async () => {
    vi.useFakeTimers();
    const { fetchMock, stop } = observe('PREPARING');

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ORDER_TRACK_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ORDER_TRACK_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    stop();
  });

  it('incelemedeki siparis de yoklanir (onaylaninca cizgi kendiliginden gelir)', async () => {
    vi.useFakeTimers();
    const { fetchMock, stop } = observe('REVIEW');

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(ORDER_TRACK_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('teslim edilen ve iptal edilen sipariste yoklama yok', async () => {
    vi.useFakeTimers();
    for (const status of ['DELIVERED', 'CANCELLED'] as const) {
      const { fetchMock, stop } = observe(status);

      await vi.advanceTimersByTimeAsync(ORDER_TRACK_POLL_MS * 3 + 100);
      expect(fetchMock, status).toHaveBeenCalledTimes(1);
      stop();
    }
  });

  it('sekme gizliyken durur', async () => {
    vi.useFakeTimers();
    const { fetchMock, stop } = observe('ON_THE_WAY');

    await vi.advanceTimersByTimeAsync(100);
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(ORDER_TRACK_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });
});

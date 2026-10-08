/**
 * Yukleniyor gostergesi (F18; PM S1-S3 a): yalniz tam ekran bekleyislerde
 * (icerik kapisi, oturum kontrolu). Bekleyis 300 ms'yi asarsa gorunur,
 * gorunduyse en az 600 ms kalir; hizli bekleyiste hic gorunmez. Ekran
 * okuyucu tam metni bir kez okur; harf harf yazi hareket azaltmada sabit.
 * Metin icerikten ya da yedekten (icerik gelmeden de gorunur).
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequireAuth } from '../../src/features/auth/ui/RequireAuth';
import { useAppLoadingTexts } from '../../src/features/content/hooks/useAppLoadingTexts';
import type { AppLoadingTexts } from '../../src/features/content/hooks/useAppLoadingTexts';
import {
  APP_LOADER_MIN_VISIBLE_MS,
  APP_LOADER_SHOW_AFTER_MS,
} from '../../src/shared/config/constants';
import { AppLoader, loaderLetters } from '../../src/shared/ui/app-loader/AppLoader';
import { createLoaderGate } from '../../src/shared/ui/app-loader/loader-gate';

import { block, css, tokens } from './css-test-support';

describe('titreme korumasi (300 ms esik, en az 600 ms)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Sahte saatle surulen saat (uretimde tekduze performance.now).
  const clock = {
    now: () => Date.now(),
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const gate = () => {
    const seen: boolean[] = [];
    const timing = {
      showAfterMs: APP_LOADER_SHOW_AFTER_MS,
      minVisibleMs: APP_LOADER_MIN_VISIBLE_MS,
    };
    return { seen, gate: createLoaderGate((visible) => seen.push(visible), timing, clock) };
  };

  it('sabitler plandaki gibi', () => {
    expect([APP_LOADER_SHOW_AFTER_MS, APP_LOADER_MIN_VISIBLE_MS]).toEqual([300, 600]);
  });

  it('bekleyis 300 ms surmezse gosterge HIC gorunmez', () => {
    const { seen, gate: g } = gate();
    g.busy(true);
    vi.advanceTimersByTime(299);
    g.busy(false);
    vi.advanceTimersByTime(2_000);

    expect(seen).toEqual([]);
  });

  it("300 ms'de gorunur; bekleyis hemen bitse de gorunmeden itibaren 600 ms kalir", () => {
    const { seen, gate: g } = gate();
    g.busy(true);
    vi.advanceTimersByTime(300);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(50);
    g.busy(false);
    vi.advanceTimersByTime(549);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true, false]);
  });

  it('en az sure dolduktan sonra biten bekleyiste hemen kaybolur', () => {
    const { seen, gate: g } = gate();
    g.busy(true);
    vi.advanceTimersByTime(1_200);
    g.busy(false);

    expect(seen).toEqual([true, false]);
  });

  it('kaybolmayi beklerken yeni bekleyis baslarsa gosterge kalir (kirpmaz)', () => {
    const { seen, gate: g } = gate();
    g.busy(true);
    vi.advanceTimersByTime(400);
    g.busy(false);
    vi.advanceTimersByTime(100);
    g.busy(true);
    vi.advanceTimersByTime(2_000);
    expect(seen).toEqual([true]);
    g.busy(false);

    expect(seen).toEqual([true, false]);
  });

  it('kapatilinca bekleyen gosterim iptal edilir', () => {
    const { seen, gate: g } = gate();
    g.busy(true);
    g.dispose();
    vi.advanceTimersByTime(2_000);

    expect(seen).toEqual([]);
  });
});

const TEXTS = { brand: 'getir', service: 'market', label: 'Yükleniyor...' };

describe('AppLoader (gorunum ve erisilebilirlik)', () => {
  const html = renderToStaticMarkup(createElement(AppLoader, TEXTS));

  it('tek durum bolgesi BOS acilir (metin ardindan yazilir, bir kez okunur); harfler ve daire okunmaz', () => {
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/<span[^>]*role="status"[^>]*><\/span>/);
    expect(html).toMatch(/<span[^>]*c-app-loader__disc[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*c-app-loader__typed/);
  });

  it('dairede ortak logo: ters renk ve ust uste (sari "getir", beyaz "market")', () => {
    expect(html).toMatch(/class="[^"]*c-logo--inverse[^"]*c-logo--stacked[^"]*"/);
    expect(html).toContain('>getir</span>');
    expect(html).toContain('>market</span>');
  });

  it('harf harf: her harf ayri, sirasi gecikmeyi verir; Turkce harfler tek parca', () => {
    expect(loaderLetters('Yükleniyor...')).toHaveLength(13);
    expect(loaderLetters('Yu\u0308kle')).toEqual(['Y', 'u\u0308', 'k', 'l', 'e']);
    const letters = [...html.matchAll(/--c-app-loader-index:(\d+)[^>]*>([^<]+)</g)];
    expect(letters.map(([, index]) => Number(index))).toEqual([...Array(13).keys()]);
    expect(letters.map(([, , letter]) => letter).join('')).toBe('Yükleniyor...');
    expect(html).toContain('--c-app-loader-count:13');
  });

  it('kelime hepsi birden silinir: kap ayni anda gizler, harf gecikmesi yazma suresinin icinde', () => {
    const source = css('shared/ui/app-loader/AppLoader.module.css');

    // Yazma suresi donguden turetilir (en fazla %30; kelime %70'te silinir).
    expect(tokens()).toContain(
      '--duration-loader-typing: calc(var(--duration-loader-cycle) * 0.2);',
    );
    expect(block(source, '.c-app-loader__typed')).toMatch(/c-app-loader-clear .* infinite/);
    expect(block(source, '.c-app-loader__letter')).toContain(
      'var(--duration-loader-typing) * var(--c-app-loader-index) / var(--c-app-loader-count)',
    );
  });

  it('hareket azaltmada yazi tam ve sabit (dongu yok)', () => {
    const source = css('shared/ui/app-loader/AppLoader.module.css');
    const reduced = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(block(source, '.c-app-loader__letter')).toContain('infinite');
    expect(block(reduced, '.c-app-loader__letter')).toContain('animation: none');
    expect(block(reduced, '.c-app-loader__letter')).toContain('opacity: 1');
    expect(reduced).toContain('.c-app-loader__typed,\n  .c-app-loader__letter {');
  });
});

describe('baglanti', () => {
  const withQuery = (child: ReturnType<typeof createElement>) =>
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MemoryRouter, null, child),
    );

  it('metinler icerik gelmeden yedekten (gosterge metin beklemez)', () => {
    let texts: AppLoadingTexts | undefined;
    function Probe() {
      texts = useAppLoadingTexts();
      return null;
    }
    renderToStaticMarkup(withQuery(createElement(Probe)));

    expect(texts).toEqual({
      brand: CONTENT_FALLBACK.brand,
      service: CONTENT_FALLBACK.service,
      label: CONTENT_FALLBACK.appLoading.label,
    });
  });

  it('oturum kontrolu surerken korumali sayfa cizilmez; kodda sabit metin yok', () => {
    const html = renderToStaticMarkup(
      withQuery(createElement(RequireAuth, null, createElement('p', null, 'gizli sayfa'))),
    );

    expect(html).not.toContain('gizli sayfa');
    expect(html).not.toContain('Oturumun kontrol ediliyor');
  });
});

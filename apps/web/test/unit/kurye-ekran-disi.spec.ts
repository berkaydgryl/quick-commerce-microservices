/**
 * Ekran disi kurye gostergesi (kullanici istegi): harita kaydirilinca ya da
 * yakinlastirilinca kurye gorunen alanin disindaysa kenarda, kuryenin
 * yonunde haritadaki kurye isaretiyle ayni cizim ve gorunus; altinda adrese
 * kalan mesafe ("650 m", "1,2 km"); kurye (isaretinin bir parcasi bile)
 * gorununce yok. Ad ve aciklama icerikten.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { Map as LeafletMap } from 'leaflet';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  edgePlacement,
  indicatorCenter,
  samePlacement,
} from '../../src/features/tracking/services/edge-placement';
import { watchEdgePlacement } from '../../src/features/tracking/services/edge-watch';
import { distanceText } from '../../src/features/tracking/services/tracking-format';
import { OffscreenCourier } from '../../src/features/tracking/ui/OffscreenCourier';
import { markerHtml } from '../../src/features/tracking/ui/tracking-marker-svg';

import { block, css, tokens } from './css-test-support';

const TEXTS = CONTENT_FALLBACK.courierTracking;
const SIZE = { width: 400, height: 200 };

describe('kenardaki yer ve yon (saf)', () => {
  it('kurye gorunen alandaysa (kenar dahil) gosterge yok', () => {
    for (const point of [
      { x: 200, y: 100 },
      { x: 0, y: 0 },
      { x: 400, y: 200 },
    ]) {
      expect(edgePlacement(SIZE, point), JSON.stringify(point)).toBeNull();
    }
  });

  it('sagda: sag kenar, merkez hizasi, yon 0 derece; asagida: alt kenar, 90 derece', () => {
    expect(edgePlacement(SIZE, { x: 900, y: 100 })).toEqual({ x: 400, y: 100, angle: 0 });
    expect(edgePlacement(SIZE, { x: 200, y: 700 })).toEqual({ x: 200, y: 200, angle: 90 });
  });

  it('kosegende: merkezden kuryeye giden dogrunun kenari kestigi nokta', () => {
    // Merkez (200,100); kurye (-200,-300): 45 derecelik dogru once ust kenara
    // (y=0) deger, merkezden 100 px solda.
    const placement = edgePlacement(SIZE, { x: -200, y: -300 });

    expect(placement?.y).toBe(0);
    expect(placement?.x).toBeCloseTo(100);
    expect(placement?.angle).toBeCloseTo(-135);
  });

  it('isaretin bir parcasi gorunuyorsa (merkez yaricap kadar disarida) gosterge yok: iki kurye olmaz', () => {
    expect(edgePlacement(SIZE, { x: 410, y: 100 }, 18)).toBeNull();
    expect(edgePlacement(SIZE, { x: 420, y: 100 }, 18)).toEqual({ x: 400, y: 100, angle: 0 });
  });

  it('henuz yerlesmemis harita (boyut 0): gosterge yok', () => {
    expect(edgePlacement({ width: 0, height: 0 }, { x: 10, y: 10 })).toBeNull();
  });

  it('ayni yer ve yon ayni sayilir (gereksiz cizim yok)', () => {
    const a = { x: 1, y: 2, angle: 3 };

    expect(samePlacement(a, { ...a })).toBe(true);
    expect(samePlacement(a, { ...a, angle: 4 })).toBe(false);
    expect(samePlacement(null, null)).toBe(true);
    expect(samePlacement(a, null)).toBe(false);
  });
});

/** Leaflet'in kullanilan yuzu: boyut, piksel, izdusum ve olay dinleyicileri. */
function fakeMap() {
  const handlers = new Map<string, Set<(event?: unknown) => void>>();
  let pixel = { x: 900, y: 100 };
  const scale = (zoom: number) => 2 ** zoom;
  const toPoint = (latLng: unknown, zoom: number) => {
    const [lat, lng] = Array.isArray(latLng)
      ? (latLng as [number, number])
      : [(latLng as { lat: number }).lat, (latLng as { lng: number }).lng];
    return { x: lng * scale(zoom), y: -lat * scale(zoom) };
  };
  const map = {
    getSize: () => ({ x: SIZE.width, y: SIZE.height }),
    latLngToContainerPoint: () => pixel,
    project: toPoint,
    on(types: string, fn: (event?: unknown) => void) {
      for (const type of types.split(' ')) {
        const set = handlers.get(type) ?? new Set();
        set.add(fn);
        handlers.set(type, set);
      }
      return map;
    },
    off(types: string, fn: (event?: unknown) => void) {
      for (const type of types.split(' ')) handlers.get(type)?.delete(fn);
      return map;
    },
  };
  return {
    leaflet: map as unknown as LeafletMap,
    fire: (type: string, event?: unknown) => handlers.get(type)?.forEach((fn) => fn(event)),
    listeners: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
    place: (next: { x: number; y: number }) => {
      pixel = next;
    },
  };
}

/** Olcusuz geometri: yaricap ve pay 0, kontrol yok (yalniz kenar noktasi). */
const FLAT = { radius: () => 0, inset: () => 0, obstacles: () => [] };

describe('gostergenin merkezi: kenardan iceride, Leaflet kontrollerinin yaninda', () => {
  const ZOOM = { left: 10, top: 10, right: 44, bottom: 76 };
  const ATTRIBUTION = { left: 170, top: 184, right: 400, bottom: 200 };

  it('kenar noktasi kaptan pay kadar iceri cekilir; yon degismez', () => {
    expect(indicatorCenter({ x: 400, y: 100, angle: 0 }, SIZE, 44, [])).toEqual({
      x: 356,
      y: 100,
      angle: 0,
    });
  });

  it('sol kenarda yakinlastirma dugmesine binerse dugmenin ALTINA kayar', () => {
    expect(indicatorCenter({ x: 0, y: 20, angle: -170 }, SIZE, 44, [ZOOM])).toEqual({
      x: 44,
      y: 120,
      angle: -170,
    });
  });

  it('ust kenarda binerse dugmenin SAGINA kayar', () => {
    expect(indicatorCenter({ x: 30, y: 0, angle: -100 }, SIZE, 44, [ZOOM])).toEqual({
      x: 88,
      y: 44,
      angle: -100,
    });
  });

  it('sag altta atifin USTUNE kayar (atif okunur kalir)', () => {
    expect(indicatorCenter({ x: 400, y: 190, angle: 10 }, SIZE, 44, [ATTRIBUTION])).toEqual({
      x: 356,
      y: 140,
      angle: 10,
    });
  });
});

describe('haritayi izleme (abone ol, yeniden hesapla, birak)', () => {
  it('sonuc gostergenin merkezi: pay ve kontroller her hesapta okunur', () => {
    const map = fakeMap();
    const seen = vi.fn();
    map.place({ x: -300, y: -100 });
    watchEdgePlacement(
      map.leaflet,
      { lat: 0, lng: 0 },
      {
        radius: () => 0,
        inset: () => 44,
        obstacles: () => [{ left: 10, top: 10, right: 44, bottom: 76 }],
      },
      seen,
    );

    expect(seen.mock.lastCall?.[0]).toMatchObject({ x: 44, y: 120 });
  });

  it('acilista hesaplar; kaydirmada yeniden; birakinca dinleyici kalmaz', () => {
    const map = fakeMap();
    const seen = vi.fn();
    const stop = watchEdgePlacement(map.leaflet, { lat: 0, lng: 0 }, FLAT, seen);

    expect(seen).toHaveBeenLastCalledWith({ x: 400, y: 100, angle: 0 });
    map.place({ x: 200, y: 100 });
    map.fire('move');
    expect(seen).toHaveBeenLastCalledWith(null);
    expect(map.listeners()).toBe(3);

    stop();
    map.fire('move');
    map.fire('zoomanim', { center: { lat: 0, lng: 0 }, zoom: 1 });
    expect(map.listeners()).toBe(0);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('yakinlastirma animasyonunda hedef merkez ve seviyeyle ONCEDEN hesaplar', () => {
    const map = fakeMap();
    const seen = vi.fn();
    watchEdgePlacement(map.leaflet, { lat: 0, lng: 10 }, FLAT, seen);

    // Seviye 5: kurye merkezden 320 px sagda (kap 400 genis) -> sag kenarda gosterge.
    map.fire('zoomanim', { center: { lat: 0, lng: 0 }, zoom: 5 });
    expect(seen).toHaveBeenLastCalledWith({ x: 400, y: 100, angle: 0 });
    // Seviye 3: 80 px sagda -> gorunur, gosterge yok.
    map.fire('zoomanim', { center: { lat: 0, lng: 0 }, zoom: 3 });
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('kurye isaretinin yaricapi her hesapta okunur', () => {
    const map = fakeMap();
    const seen = vi.fn();
    map.place({ x: 410, y: 100 });
    watchEdgePlacement(map.leaflet, { lat: 0, lng: 0 }, { ...FLAT, radius: () => 18 }, seen);

    expect(seen).toHaveBeenLastCalledWith(null);
  });
});

describe('gosterge (gorunum ve erisilebilirlik)', () => {
  const html = (meters: number | undefined) =>
    renderToStaticMarkup(
      createElement(OffscreenCourier, {
        placement: { x: 400, y: 100, angle: 0 },
        distance: meters === undefined ? undefined : distanceText(meters, TEXTS),
        texts: TEXTS,
        onShow: () => undefined,
        onLeave: () => undefined,
      }),
    );

  it('dugmenin adi icerikten; aciklamasi "Kalan mesafe 650 m" (gorunen sayi), "1,2 km"', () => {
    const markup = html(650);
    const described = /aria-describedby="([^"]+)"/.exec(markup)?.[1];

    expect(markup).toMatch(/<button type="button"[^>]*aria-label="Kuryeyi haritada göster"/);
    expect(markup).toMatch(
      new RegExp(`<span id="${described ?? '-'}"[^>]*><span[^>]*>Kalan mesafe </span>650 m</span>`),
    );
    expect(html(1234)).toContain('</span>1,2 km</span>');
  });

  it('teslimde mesafe yok: aciklama ve sayi yazilmaz', () => {
    const markup = html(undefined);

    expect(markup).not.toContain('aria-describedby');
    expect(markup).not.toContain('Kalan mesafe');
  });

  it('yer ve yon CSS degiskeniyle (px, derece); cizim ekran okuyucudan gizli', () => {
    const markup = html(650);

    expect(markup).toContain('--c-offscreen-courier-x:400px');
    expect(markup).toContain('--c-offscreen-courier-y:100px');
    expect(markup).toContain('--c-offscreen-courier-angle:0deg');
    expect(markup).toMatch(/<span class="[^"]*c-offscreen-courier__disc[^"]*" aria-hidden="true">/);
  });

  it('haritadaki kurye isaretiyle AYNI cizim ve AYNI gorunus sinifi (tek kaynak)', () => {
    const shapes = (svg: string) =>
      [...svg.matchAll(/<(circle|path)([^>]*?)\/?>/g)].map(([, tag, attrs]) => `${tag}${attrs}`);
    const markup = html(650);

    expect(shapes(markup)).toEqual(shapes(markerHtml('courier')));
    expect(markup).toMatch(/c-offscreen-courier__disc[^"]*c-tracking-map__marker--courier/);
  });
});

describe('gostergenin bicimi (token)', () => {
  const source = css('features/tracking/ui/OffscreenCourier.module.css');

  it('kenardan token kadar iceride; en az 44 px dokunma alani; yer fiziksel (left/top)', () => {
    const root = block(source, '.c-offscreen-courier');

    expect(root).toContain('var(--size-tracking-edge-inset)');
    expect(root).toMatch(/\n {2}left: clamp\(/);
    expect(root).toMatch(/\n {2}top: clamp\(/);
    expect(root).toContain('min-width: var(--size-touch-min)');
    expect(root).toContain('min-height: var(--size-touch-min)');
    expect(tokens()).toContain('--size-tracking-pointer:');
  });

  it('Leaflet kontrollerinin (1000) altinda, isaretlerin (600) ustunde; harita kendi yigininda', () => {
    const level = Number(/--z-map-indicator: (\d+);/.exec(tokens())?.[1]);

    expect(block(source, '.c-offscreen-courier')).toContain('z-index: var(--z-map-indicator)');
    expect(level).toBeGreaterThan(600);
    expect(level).toBeLessThan(1000);
    expect(block(css('features/tracking/ui/TrackingMap.module.css'), '.c-tracking-map')).toContain(
      'isolation: isolate',
    );
  });

  it('yon ucu mesafeye degmez; odak haritaya gecince halka iceride gorunur', () => {
    expect(block(source, '.c-offscreen-courier')).toContain(
      'gap: calc(var(--size-tracking-pointer) + var(--space-1))',
    );
    expect(
      block(
        css('features/tracking/ui/TrackingMap.module.css'),
        '.c-tracking-map__canvas:focus-visible',
      ),
    ).toContain('outline-offset: calc(var(--focus-ring-width) * -1)');
  });

  it('mesafe sabit genislikte rakam; "Kalan mesafe" yalniz ekran okuyucuda', () => {
    expect(block(source, '.c-offscreen-courier__distance')).toContain(
      'font-variant-numeric: tabular-nums',
    );
    expect(block(source, '.c-offscreen-courier__sr')).toContain('clip-path: inset(50%)');
  });
});

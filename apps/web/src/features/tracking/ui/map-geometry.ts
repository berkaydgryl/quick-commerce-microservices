/**
 * Ekran disi kurye gostergesinin DOM olculeri (px): token uzunlugu tarayiciya
 * olcturulur (rem, calc fark etmez; JS'te ciplak sayi yok) ve Leaflet
 * kontrollerinin (yakinlastirma, atif) kap icindeki yeri.
 */

import type { Rect } from '../services/edge-placement';

/** CSS degiskeninin (uzunluk) piksel karsiligi; olcum icin gecici, gorunmez kutu. */
export function tokenPx(host: HTMLElement, token: string): number {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.width = `var(${token})`;
  host.append(probe);
  const pixels = probe.getBoundingClientRect().width;
  probe.remove();
  return pixels;
}

/** Leaflet kontrollerinin kap icindeki dikdortgenleri. */
export function controlRects(container: HTMLElement): Rect[] {
  const base = container.getBoundingClientRect();
  return [...container.querySelectorAll('.leaflet-control')].map((control) => {
    const box = control.getBoundingClientRect();
    return {
      left: box.left - base.left,
      top: box.top - base.top,
      right: box.right - base.left,
      bottom: box.bottom - base.top,
    };
  });
}

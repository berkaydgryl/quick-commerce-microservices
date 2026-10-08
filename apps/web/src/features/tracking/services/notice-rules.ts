/**
 * Bildirim ve pencere kurallari (F22; QA K9 B1, B3, N1): saf fonksiyonlar,
 * kancalar yalniz cagirir. DOM'a ve React'e bagimli degil; birim testi dogrudan.
 */

import type { TrackingMode } from '../api/queries';

/** Kapanma suresi fare YA DA odak bildirimdeyken durur (N1): ikisi ayri bayrak. */
export function noticePaused(hovered: boolean, focused: boolean): boolean {
  return hovered || focused;
}

/**
 * Kapanan oge (pencere ya da bildirim) sonrasi odak (B1, B3): yalniz odak o
 * ogenin ICINDEYDI ve sayfaya dustuyse tasinir. Hedef ("Kuryem nerede") yoksa
 * ya da odaklanamazsa (pasif) yedege (takip kartinin basligi; o da yoksa
 * sayfanin basligi; kapsayici secer).
 * Etkilesmemis kullanicinin odagi ve sayfasi kipirdamaz (kendiliginden kapanan
 * bildirim).
 */
export function focusAfterClose(input: {
  readonly closed: boolean;
  readonly focusWasInside: boolean;
  readonly activeIsPage: boolean;
  readonly targetAvailable: boolean;
}): 'target' | 'fallback' | 'none' {
  if (!input.closed || !input.focusWasInside || !input.activeIsPage) {
    return 'none';
  }
  return input.targetAvailable ? 'target' : 'fallback';
}

/**
 * Bicim degisince yeniden istek (B3): pencere acilinca guncel konum ('join':
 * suren istege katilir, cift istek yok); pencere acikken siparis son duruma
 * gecince ('once') TAZE istek ('fresh': suren eski istek iptal edilir, yoksa
 * teslimden onceki cevap son durum sanilirdi; code-review).
 */
export function refetchOnModeChange(
  previous: TrackingMode,
  next: TrackingMode,
): 'join' | 'fresh' | 'none' {
  if (next === previous) {
    return 'none';
  }
  if (next === 'once') {
    return 'fresh';
  }
  return next === 'open' ? 'join' : 'none';
}

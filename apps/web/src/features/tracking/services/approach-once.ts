/**
 * Yaklasma bildirimi BIR KEZ (F22, PM S3 a): siparis basina, sekme oturumu
 * boyunca. Yalnizca siparis kimligi bayragi sessionStorage'da tutulur (konum
 * ya da kurye bilgisi yazilmaz); yenilemede bildirim tekrar cikmaz. Depo
 * kullanilamazsa (ozel mod) bellekteki kume yeter.
 */

const PREFIX = 'getir.courier-approach.';
const shown = new Set<string>();

export function approachNotified(orderId: string): boolean {
  if (shown.has(orderId)) {
    return true;
  }
  try {
    return window.sessionStorage.getItem(PREFIX + orderId) === '1';
  } catch {
    return false;
  }
}

export function markApproachNotified(orderId: string): void {
  shown.add(orderId);
  try {
    window.sessionStorage.setItem(PREFIX + orderId, '1');
  } catch {
    // Depo kapali: bellekteki kume bu sekmede yeter.
  }
}

/** Bildirim karari: gosterilsin mi, yalniz isaretlensin mi (harita zaten acik), yoksa hicbir sey. */
export type ApproachDecision = 'show' | 'mark' | 'none';

export function approachDecision(
  approaching: boolean,
  alreadyNotified: boolean,
  dialogOpen: boolean,
  /** Bildirimin metinleri hazir mi: degilse beklenir, ISARETLENMEZ (gorulmeden kaybolmasin). */
  canShow = true,
): ApproachDecision {
  if (!approaching || alreadyNotified || !canShow) {
    return 'none';
  }
  return dialogOpen ? 'mark' : 'show';
}

/** Testler icin: bellekteki kumeyi bosaltir. */
export function resetApproachMemory(): void {
  shown.clear();
}

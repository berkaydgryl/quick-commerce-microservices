/**
 * Yenilemede 3DS'i surdurmek icin (F15b, #163): sekmenin sessionStorage'inda
 * YALNIZ bekleyen siparisin kimligi (PM sart 2). Kod (OTP) ve challengeId hicbir
 * depoya, adrese ya da gunluge yazilmaz; challenge yenilemede sunucudan okunur.
 * Kayit sozlesmenin siparis kimligi bicimine uymuyorsa yok sayilir. Depo
 * kullanilamazsa (ozel mod) surdurme yalniz olmaz; akis bozulmaz.
 */

import { orderIdSchema } from '@getir/contracts';

const KEY = 'getir.pending-3ds';

export function readPendingThreeDs(): string | undefined {
  try {
    const value = window.sessionStorage.getItem(KEY);
    return value !== null && orderIdSchema.safeParse(value).success ? value : undefined;
  } catch {
    return undefined;
  }
}

export function savePendingThreeDs(orderId: string): void {
  // Depo siniri: yalniz siparis kimligi bicimi (kod ya da jeton yanlislikla yazilamaz).
  if (!orderIdSchema.safeParse(orderId).success) return;
  try {
    window.sessionStorage.setItem(KEY, orderId);
  } catch {
    // Depo kapali: yenilemede surdurme olmaz, akis aynen calisir.
  }
}

export function clearPendingThreeDs(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Depo kapali: silinecek kayit da yok.
  }
}

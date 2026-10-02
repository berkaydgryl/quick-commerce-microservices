/**
 * Giris ve kayit penceresinin gecmis durumu (T11.6; history state).
 *
 * - phoneEntry: karsilama kartinda ya da karsi pencerede yazilan numara; pencere
 *   dolu acilir. Numara ADRESE YAZILMAZ (kisisel veri: gecmis, gunluk,
 *   paylasilan baglanti), gecmis kaydinin durumunda tasinir.
 * - fromApp: pencere uygulama icinden acildi (karsilama ekraninin dugmeleri).
 *   Kapatinca bir geri gidilir (geri tusuyla ayni sonuc); adres dogrudan
 *   acildiysa (yer imi, korumali sayfa yonlendirmesi) karsilama ekranina gidilir.
 * - demo: pencere karsilama kartindaki demo hesaplardan acildi (yalnizca
 *   gelistirme). Sifre gecmise YAZILMAZ; giris penceresi demo sifresini
 *   kendisi doldurur (production paketinde demo sifresi yoktur).
 *
 * Durum disaridan gelen veri sayilir (eski bir gecmis kaydi baska sekilde
 * olabilir): okunurken Zod'dan gecer, uymayan alan yok sayilir.
 */

import { z } from 'zod';

/** Ulke kodu ve sonrasindaki rakamlar ("+90", "5321234567"). */
export interface PhoneEntry {
  readonly dialCode: string;
  readonly digits: string;
}

export interface AuthRouteState {
  readonly phoneEntry?: PhoneEntry | undefined;
  readonly fromApp?: boolean | undefined;
  readonly demo?: boolean | undefined;
}

const authRouteStateSchema = z.object({
  phoneEntry: z.object({ dialCode: z.string(), digits: z.string() }).optional().catch(undefined),
  fromApp: z.boolean().optional().catch(undefined),
  demo: z.boolean().optional().catch(undefined),
});

/** Okunan durum: alan yoksa ya da bicimsizse varsayilan. */
export interface ReadAuthRouteState {
  readonly phoneEntry: PhoneEntry | null;
  readonly fromApp: boolean;
  readonly demo: boolean;
}

export function readAuthRouteState(state: unknown): ReadAuthRouteState {
  const parsed = authRouteStateSchema.safeParse(state);
  if (!parsed.success) {
    return { phoneEntry: null, fromApp: false, demo: false };
  }
  return {
    phoneEntry: parsed.data.phoneEntry ?? null,
    fromApp: parsed.data.fromApp ?? false,
    demo: parsed.data.demo ?? false,
  };
}

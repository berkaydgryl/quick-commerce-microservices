/**
 * Secili teslimat adresinin tarayicida KALICI yazimi (T9.5): SAF kurallar.
 *
 * Roadmap "localStorage senkronizasyonu": anahtar `getir.address`, icerik
 * secili adres, omru kalici. Cikista silinmez: ayni kullanici donunce secimini
 * bulur (cikis sayfayi yeniden yukler; bellek zaten bosalir). Baska sekmede
 * yapilan secim bu sekmeye de gelir (useAddressStorageSync; sepetteki gibi).
 *
 * KIMLIK: sozlesmede adres kimligi yok (savedAddressSchema); adres ADIYLA
 * taninir (30 Eylul karari; demoda adlar tekil). Secim KULLANICIYA baglidir:
 * ayni tarayicida baska hesapla girilirse onceki hesabin secimi uygulanmaz.
 *
 * NEDEN OKUNAN KAYIT DOGRULANIR: localStorage guvenilmez girdidir. Gecersiz,
 * eski bicimli ya da elle degistirilmis kayit "secim yok" demektir, hata degil.
 */

import { idSchema } from '@getir/contracts';
import { z } from 'zod';

/** Roadmap'teki anahtar tablosu: `getir.` onekli. */
export const ADDRESS_STORAGE_KEY = 'getir.address';

/** Kayit bicimi degisince artirilir; farkli surumlu kayit atilir. */
export const ADDRESS_STORAGE_VERSION = 1;

const selectionSchema = z.object({
  userId: idSchema,
  title: z.string().trim().min(1),
});

const persistedAddressSchema = z.object({
  selection: selectionSchema.nullable(),
});

/** Kimin, hangi adresi sectigi. */
export type AddressSelection = z.infer<typeof selectionSchema>;

/** Depoya yazilan bicim: yalnizca secim; aksiyonlar degil. */
export type PersistedAddress = z.infer<typeof persistedAddressSchema>;

/** Zustand persist'in depoya yazdigi zarf: surum baska sekmenin olayinda okunur. */
const storedEnvelopeSchema = z.object({ version: z.number() });

/** Farkli surumden gelen kaydin yerine yazilan bos kayit (surum kurali). */
export const DISCARDED_ADDRESS: PersistedAddress = { selection: null };

/** Depodan okunani secime cevirir; kayit yoksa ya da bozuksa secim yoktur. */
export function restoreSelection(persisted: unknown): AddressSelection | null {
  const parsed = persistedAddressSchema.safeParse(persisted);
  return parsed.success ? parsed.data.selection : null;
}

/**
 * Baska sekmenin depo olayindan sonra kayit yeniden okunmali mi?
 *  - tum depo temizlendi (anahtar null) ya da kayit silindi (yeni deger null):
 *    evet, secim kalkar;
 *  - baska anahtar: hayir;
 *  - BU surumun yazdigi kayit: evet;
 *  - baska surumun (eski ya da yeni surumlu acik sekme) ya da okunamayan kayit:
 *    HAYIR. Okunsaydi bu sekme kaydi atip kendi surumunu geri yazar, oteki sekme
 *    de kendisininkini: iki sekme birbirini sonsuza dek ezerdi.
 */
export function shouldRehydrateAddress(key: string | null, newValue: string | null): boolean {
  if (key === null) {
    return true;
  }
  if (key !== ADDRESS_STORAGE_KEY) {
    return false;
  }
  if (newValue === null) {
    return true;
  }
  return storedVersion(newValue) === ADDRESS_STORAGE_VERSION;
}

function storedVersion(raw: string): number | null {
  try {
    const parsed = storedEnvelopeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}

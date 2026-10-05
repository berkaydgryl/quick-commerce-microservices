/**
 * Secili teslimat adresinin tarayicida KALICI yazimi (T9.5): SAF kurallar.
 *
 * Roadmap "localStorage senkronizasyonu": anahtar `getir.address`, icerik
 * secili adres, omru kalici. Cikista silinmez: ayni kullanici donunce secimini
 * bulur (cikis sayfayi yeniden yukler; bellek zaten bosalir). Baska sekmede
 * yapilan secim bu sekmeye de gelir (useAddressStorageSync; sepetteki gibi).
 *
 * KIMLIK (T11.15): adres kalici kimligiyle (adr_) taninir; ad degisebilir.
 * Surum 1 kayitlari (T9.5-T11.14) adla secerdi: okununca silinmez, adla secim
 * olarak tasinir ve defter gelince adla eslesip kimlige cevrilir (K3 (a),
 * upgradeSelection). Secim KULLANICIYA baglidir: ayni tarayicida baska hesapla
 * girilirse onceki hesabin secimi uygulanmaz.
 *
 * NEDEN OKUNAN KAYIT DOGRULANIR: localStorage guvenilmez girdidir. Gecersiz,
 * eski bicimli ya da elle degistirilmis kayit "secim yok" demektir, hata degil.
 */

import { addressIdSchema, idSchema } from '@getir/contracts';
import type { SavedAddress } from '@getir/contracts';
import { z } from 'zod';

/** Roadmap'teki anahtar tablosu: `getir.` onekli. */
export const ADDRESS_STORAGE_KEY = 'getir.address';

/**
 * Kayit bicimi degisince artirilir. Surum 2 (T11.15): kimlikle secim. Surum 1
 * (adla secim) tasinir (migrateAddress); baska surumlu kayit atilir.
 */
export const ADDRESS_STORAGE_VERSION = 2;
export const LEGACY_ADDRESS_STORAGE_VERSION = 1;

const idSelectionSchema = z.object({
  userId: idSchema,
  addressId: addressIdSchema,
});

/** Surum 1'in secimi: adla. Yalnizca cevrilene kadar yasar. */
const titleSelectionSchema = z.object({
  userId: idSchema,
  title: z.string().trim().min(1),
});

const storedSelectionSchema = z.union([idSelectionSchema, titleSelectionSchema]);

const persistedAddressSchema = z.object({
  selection: storedSelectionSchema.nullable(),
});

const legacyPersistedSchema = z.object({
  selection: titleSelectionSchema.nullable(),
});

/** Kimin, hangi adresi sectigi (yeni secimler hep kimlikle). */
export type AddressSelection = z.infer<typeof idSelectionSchema>;

/** Depodaki secim: kimlikle ya da henuz cevrilmemis eski kayitta adla. */
export type StoredSelection = z.infer<typeof storedSelectionSchema>;

/** Depoya yazilan bicim: yalnizca secim; aksiyonlar degil. */
export type PersistedAddress = z.infer<typeof persistedAddressSchema>;

/** Zustand persist'in depoya yazdigi zarf: surum baska sekmenin olayinda okunur. */
const storedEnvelopeSchema = z.object({ version: z.number() });

/** Farkli surumden gelen kaydin yerine yazilan bos kayit (surum kurali). */
export const DISCARDED_ADDRESS: PersistedAddress = { selection: null };

/** Depodan okunani secime cevirir; kayit yoksa ya da bozuksa secim yoktur. */
export function restoreSelection(persisted: unknown): StoredSelection | null {
  const parsed = persistedAddressSchema.safeParse(persisted);
  return parsed.success ? parsed.data.selection : null;
}

/**
 * Farkli surumlu kayit (Zustand persist migrate): surum 1'in adla secimi
 * TASINIR (kullanici secimini kaybetmesin; K3 (a)), gerisi atilir.
 */
export function migrateAddress(persisted: unknown, version: number): PersistedAddress {
  if (version !== LEGACY_ADDRESS_STORAGE_VERSION) {
    return DISCARDED_ADDRESS;
  }
  const legacy = legacyPersistedSchema.safeParse(persisted);
  return legacy.success ? legacy.data : DISCARDED_ADDRESS;
}

/** Secim adla mi (surum 1'den tasinmis, henuz cevrilmemis). */
export function isTitleSelection(
  selection: StoredSelection,
): selection is z.infer<typeof titleSelectionSchema> {
  return 'title' in selection;
}

/** Secimin isaret ettigi adres: kimlikle ya da (eski kayitta) adla; yoksa undefined. */
export function findSelected(
  addresses: readonly SavedAddress[],
  selection: StoredSelection,
): SavedAddress | undefined {
  return isTitleSelection(selection)
    ? addresses.find((address) => address.title === selection.title)
    : addresses.find((address) => address.id === selection.addressId);
}

/**
 * Adla secimin kimlikli karsiligi (K3 (a)): oturumdaki kullanicinin defterinde
 * o adda adres varsa kimlikle secim; yoksa ya da secim zaten kimlikliyse
 * undefined (cevrilecek bir sey yok; cozum defterin ilk adresine duser).
 */
export function upgradeSelection(
  selection: StoredSelection | null,
  userId: string | null,
  addresses: readonly SavedAddress[],
): AddressSelection | undefined {
  if (selection === null || userId === null || selection.userId !== userId) {
    return undefined;
  }
  if (!isTitleSelection(selection)) {
    return undefined;
  }
  const match = findSelected(addresses, selection);
  return match === undefined ? undefined : { userId, addressId: match.id };
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

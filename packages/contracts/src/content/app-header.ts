/**
 * Uygulamanin ust bari (T11.10; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Uygulamanin ust bari (T11.10): oturumlu sayfalarin (ana sayfa, marketler,
 * market, hesabim) mor bari. Logo | arama kutusu (icinde teslimat adresi) |
 * Profil. Oturumsuz ziyaretci ayni bari "Giris yap" ile gorur
 * (header.loginLabel).
 */
export const appHeaderContentSchema = z.object({
  /** Arama kutusunun erisilebilir adi ve ipucu: "Market veya urun ara". */
  searchLabel: contentTextSchema,
  searchPlaceholder: contentTextSchema,
  searchClearLabel: contentTextSchema,
  /** Kutunun icindeki adres dugmesinin erisilebilir adinin basi: "Teslimat adresi: Ev". */
  addressLabel: contentTextSchema,
  addressListLabel: contentTextSchema,
  /**
   * Adres dugmesinin actigi "Adreslerim" penceresi: radyo listesi, "Adresi
   * Onayla" ve alt bantta "Baska bir adreste misin? Adres Ekle" (harita +
   * detay; T11.8'in penceresi).
   */
  addressBookTitle: contentTextSchema,
  addressConfirmLabel: contentTextSchema,
  addressAddPrompt: contentTextSchema,
  addressAddLabel: contentTextSchema,
  /** Oturumsuz ziyaretci varsayilan adresi gorur; dugme giris ekranina gider. */
  addressLoginLabel: contentTextSchema,
  noAddressNotice: contentTextSchema,
  addressLoadingLabel: contentTextSchema,
  profileLabel: contentTextSchema,
  accountLabel: contentTextSchema,
  logoutLabel: contentTextSchema,
  logoutPendingLabel: contentTextSchema,
});

export type AppHeaderContent = z.infer<typeof appHeaderContentSchema>;

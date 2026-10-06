import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Hesap menusu (T11.16; kullanici istegi): profil sayfasinin sol menusu ve ust
 * barin Profil acilir menusu AYNI maddeleri ayni sirayla gosterir. Sira ve
 * adresler web'dedir (accountMenuItems), burada yalnizca etiketler: Profilim,
 * Adreslerim, Favori İşletmeler, Geçmiş Siparişlerim; T11.17'de Ödeme
 * Yöntemlerim eklenir.
 */
export const accountMenuContentSchema = z.object({
  /** Sol menunun erisilebilir adi: "Hesap menüsü". */
  label: contentTextSchema,
  profileLabel: contentTextSchema,
  addressesLabel: contentTextSchema,
  favoritesLabel: contentTextSchema,
  ordersLabel: contentTextSchema,
  /** "Ödeme Yöntemlerim" (T11.17): Geçmiş Siparişlerim'in altinda ayri madde. */
  paymentMethodsLabel: contentTextSchema,
});

export type AccountMenuContent = z.infer<typeof accountMenuContentSchema>;

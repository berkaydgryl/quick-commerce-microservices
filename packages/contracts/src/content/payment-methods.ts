import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Kart markalarinin gorunen adlari (T11.17): baslik hapi, liste satiri ve
 * bildirim ("Kart eklendi: Visa •••• 4242"). Anahtarlar sozlesmedeki marka.
 */
export const cardBrandLabelsSchema = z.object({
  VISA: contentTextSchema,
  MASTERCARD: contentTextSchema,
  AMEX: contentTextSchema,
  TROY: contentTextSchema,
});

/**
 * Odeme Yontemlerim (T11.17; /hesabim/odeme-yontemlerim): kayitli kartlar
 * (kucuk kart gorselleri, cop kutusu), "Kart ekle" sayfasi (tasarim B
 * "Markanin rengi": kart numarasi yazildikca marka rengine gecen kart, CVV'de
 * donme) ve silme onayi. Kural cumleleri (numara, son kullanma, CVV, ad, kart
 * adi) icerikte DEGIL, sozlesmede (CARD_FIELD_MESSAGES). Bazi metinler kartin
 * adinin ARKASINA eklenir: "Visa •••• 4242" + " " + deleteSuffix.
 */
export const paymentMethodsContentSchema = z.object({
  title: contentTextSchema,
  loadingLabel: contentTextSchema,
  emptyNotice: contentTextSchema,
  addLabel: contentTextSchema,
  /** Suresi gecen kartin rozeti. */
  expiredLabel: contentTextSchema,
  deleteSuffix: contentTextSchema,
  /** Silme onayi. */
  confirmTitle: contentTextSchema,
  confirmQuestionSuffix: contentTextSchema,
  confirmHint: contentTextSchema,
  confirmLabel: contentTextSchema,
  deletingLabel: contentTextSchema,
  cancelLabel: contentTextSchema,
  deletedToastSuffix: contentTextSchema,
  /** Kart ekle sayfasi: alanlar, olumlu ipucu, bicim uyarisi, kaydet. */
  addTitle: contentTextSchema,
  brandsLabel: contentTextSchema,
  numberLabel: contentTextSchema,
  numberValidLabel: contentTextSchema,
  holderNameLabel: contentTextSchema,
  expiryLabel: contentTextSchema,
  /** "AA/YY" eksik yazildiginda (kural cumlesi degil, bicim uyarisi). */
  expiryFormatNotice: contentTextSchema,
  cvvLabel: contentTextSchema,
  nicknameLabel: contentTextSchema,
  saveLabel: contentTextSchema,
  savingLabel: contentTextSchema,
  /**
   * Cok fazla basarisiz dogrulama (429): geri sayimin basi, "Yeniden
   * deneyebilmen için" + " 4:59"; sure bitene kadar kaydet pasif.
   */
  retryWaitLabel: contentTextSchema,
  /** Basarida bildirimin basi: "Kart eklendi:" + " Visa •••• 4242". */
  addedToastPrefix: contentTextSchema,
  privacyNote: contentTextSchema,
  /** Kartin yuzu: basliklar ve bos alanlarin yer tutuculari, arka yuz notu. */
  holderCaption: contentTextSchema,
  expiryCaption: contentTextSchema,
  holderPlaceholder: contentTextSchema,
  expiryPlaceholder: contentTextSchema,
  nicknamePlaceholder: contentTextSchema,
  cvvCaption: contentTextSchema,
  cvvNote: contentTextSchema,
  brandLabels: cardBrandLabelsSchema,
  /** Kartin ustundeki soluk buyuk marka isareti (kisa: "VISA", "MC"). */
  brandMarks: cardBrandLabelsSchema,
});

export type CardBrandLabels = z.infer<typeof cardBrandLabelsSchema>;
export type PaymentMethodsContent = z.infer<typeof paymentMethodsContentSchema>;

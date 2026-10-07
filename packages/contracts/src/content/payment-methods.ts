import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Kart markalarinin gorunen adlari (T11.17): liste satiri, bildirim ("Kart
 * eklendi: Visa •••• 4242") ve kartin ustundeki isaret. Anahtarlar
 * sozlesmedeki marka.
 */
export const cardBrandLabelsSchema = z.object({
  VISA: contentTextSchema,
  MASTERCARD: contentTextSchema,
  AMEX: contentTextSchema,
  TROY: contentTextSchema,
});

/**
 * Odeme Yontemlerim (T11.17; /hesabim/odeme-yontemlerim; duzen kullanicinin
 * referansi getircarsi): kayitli kartlar satir satir (marka logosu, ad,
 * maskeli numara, cop kutusu, sonda "Kredi/Banka Kartı"), "Kart Ekle"
 * sayfasi (en ustte tasarim B'nin kart animasyonu, alanlar, Ay/Yil, zorunlu kosul
 * onayi, Devam ve altinda kucuk guvenlik cumlesi; F14) ve silme onayi. Kural cumleleri
 * (numara, son kullanma, CVV, ad, kart adi) icerikte DEGIL, sozlesmede
 * (CARD_FIELD_MESSAGES). `*Suffix` metinleri kartin adinin arkasina eklenir.
 */
export const paymentMethodsContentSchema = z.object({
  title: contentTextSchema,
  loadingLabel: contentTextSchema,
  /** Listenin son satiri: kart ekle baglantisi. */
  addLabel: contentTextSchema,
  /** Suresi gecen kartin etiketi. */
  expiredLabel: contentTextSchema,
  /** Ekran okuyucunun kart adi: "Visa, son dört hane 4242" (maske okunmaz; QA D6). */
  lastFourLabel: contentTextSchema,
  /** Cop kutusunun adi, kartin okunan adinin arkasina: "Visa, son dört hane 4242 kartını sil". */
  deleteSuffix: contentTextSchema,
  /** Silme onayi (F13 ortak onay penceresi): tek soru; "Evet" beklerken deletingLabel. */
  confirmQuestion: contentTextSchema,
  deletingLabel: contentTextSchema,
  deletedToastSuffix: contentTextSchema,
  /** Pencerelerin X dugmesi (silme onayi, kosullar); icerik gelmese de yedekten (QA C5). */
  closeLabel: contentTextSchema,
  /** Kart ekle sayfasi (referans getircarsi "Kart Ekle"). */
  backToListLabel: contentTextSchema,
  addTitle: contentTextSchema,
  /** Guvenlik cumlesi (F14): sayfada Devam'in altinda kucuk satir; kendi metnimiz (Masterpass yok). */
  securityText: contentTextSchema,
  nicknameLabel: contentTextSchema,
  numberLabel: contentTextSchema,
  numberValidLabel: contentTextSchema,
  holderNameLabel: contentTextSchema,
  /** Son kullanma: Ay ve Yil secimleri; yillar sozlesmeden (cardExpiryYears). */
  expiryLegend: contentTextSchema,
  monthLabel: contentTextSchema,
  yearLabel: contentTextSchema,
  expiryRequiredNotice: contentTextSchema,
  cvvLabel: contentTextSchema,
  /** Zorunlu onay: baglanti + arkasindaki metin; baglanti kosullar penceresini acar. */
  termsLinkLabel: contentTextSchema,
  termsSuffix: contentTextSchema,
  termsRequiredNotice: contentTextSchema,
  termsTitle: contentTextSchema,
  termsParagraphs: z.array(contentTextSchema).min(1),
  saveLabel: contentTextSchema,
  savingLabel: contentTextSchema,
  /** Cok fazla basarisiz dogrulama (429): geri sayimin basi, "Yeniden deneyebilmen için 4:59". */
  retryWaitLabel: contentTextSchema,
  /** Ayni kart (CONFLICT, details.cardId; QA C4). */
  duplicateCardNotice: contentTextSchema,
  /**
   * Kart eklemede saglayici reddi (PAYMENT_DECLINED; F14): kart eklemek odeme degil,
   * "Ödeme alınamadı" denmez. Odeme sayfasinin cumlesi sozlukte, degismez.
   */
  addDeclinedMessage: contentTextSchema,
  /** Basarida bildirimin basi: "Kart eklendi:" + " Visa •••• 4242". */
  addedToastPrefix: contentTextSchema,
  /** Formun altindaki marka logolarinin erisilebilir adi. */
  acceptedBrandsLabel: contentTextSchema,
  /** Kartin yuzu (tasarim B): basliklar, bos alan yer tutuculari, arka yuz notu. */
  holderCaption: contentTextSchema,
  expiryCaption: contentTextSchema,
  holderPlaceholder: contentTextSchema,
  expiryPlaceholder: contentTextSchema,
  nicknamePlaceholder: contentTextSchema,
  cvvCaption: contentTextSchema,
  cvvNote: contentTextSchema,
  /** Marka adlari ve soluk kisa isaret. */
  brandLabels: cardBrandLabelsSchema,
  brandMarks: cardBrandLabelsSchema,
});

export type CardBrandLabels = z.infer<typeof cardBrandLabelsSchema>;
export type PaymentMethodsContent = z.infer<typeof paymentMethodsContentSchema>;

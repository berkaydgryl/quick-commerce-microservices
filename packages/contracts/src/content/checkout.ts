/**
 * Odeme sayfasi (T17.1; referans getircarsi odeme sayfasi; KAMPANYA YOK).
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * Odeme sayfasinin metinleri (T17.1; /odeme): hediye bilgileri (anahtar, hazir
 * notlar, alanlar), teslimat yontemi, siparis notu ve "Zili Çalma", odeme
 * yontemi (secili kart, "Değiştir", guvenlik cumlesi), odeme ozeti, sozlesme
 * onayi ve pencereleri, "Sipariş Ver". Kural cumleleri (zorunlu alan, telefon)
 * icerikte DEGIL, kural dosyasinda. Sozlesme metinleri bugun DEMO yer tutucu
 * (PM karari M6: hukuki metin uydurulmaz; kullanici verince icerikten degisir).
 */
export const checkoutContentSchema = z.object({
  /** Sayfanin h1'i (gorunmez; bolumlerin basliklari gorunur). */
  title: contentTextSchema,
  giftTitle: contentTextSchema,
  /** Anahtarin erisilebilir adi ve iki durumu: "Hediye olarak gönder", "Evet", "Hayır". */
  giftToggleLabel: contentTextSchema,
  giftYesLabel: contentTextSchema,
  giftNoLabel: contentTextSchema,
  /** Bilgi ikonu: erisilebilir adi ve actigi kisa not. */
  giftInfoLabel: contentTextSchema,
  giftInfoText: contentTextSchema,
  presetNoteLabel: contentTextSchema,
  presetNotesTitle: contentTextSchema,
  presetNotes: z.array(contentTextSchema).min(1),
  giftMessageLabel: contentTextSchema,
  senderNameLabel: contentTextSchema,
  recipientNameLabel: contentTextSchema,
  recipientPhoneLabel: contentTextSchema,
  deliveryTitle: contentTextSchema,
  /** Teslimat secenegi: "Teslimat ücreti 19,90 TL" ya da "Ücretsiz Teslimat". */
  deliveryFeeLabel: contentTextSchema,
  freeDeliveryLabel: contentTextSchema,
  noteTitle: contentTextSchema,
  noteLabel: contentTextSchema,
  notePlaceholder: contentTextSchema,
  doNotRingLabel: contentTextSchema,
  paymentTitle: contentTextSchema,
  changeLabel: contentTextSchema,
  addCardLabel: contentTextSchema,
  cardsLoadingLabel: contentTextSchema,
  noCardNotice: contentTextSchema,
  /** Odeme yonteminin altindaki kendi guvenlik cumlemiz (Masterpass yok). */
  securityNote: contentTextSchema,
  summaryTitle: contentTextSchema,
  subtotalLabel: contentTextSchema,
  /** Teslimat ucreti satiri (PM karari M5: iki tutarin farkini aciklar; kampanya degil). */
  deliveryFeeRowLabel: contentTextSchema,
  freeLabel: contentTextSchema,
  payableLabel: contentTextSchema,
  /** Onay cumlesi: "{Ön Bilgilendirme Formu} ve {Mesafeli Satış Sözleşmesi}'ni okudum, kabul ediyorum." */
  preInfoLinkLabel: contentTextSchema,
  agreementJoiner: contentTextSchema,
  distanceSalesLinkLabel: contentTextSchema,
  agreementSuffix: contentTextSchema,
  preInfoParagraphs: z.array(contentTextSchema).min(1),
  distanceSalesParagraphs: z.array(contentTextSchema).min(1),
  closeLabel: contentTextSchema,
  placeOrderLabel: contentTextSchema,
});

export type CheckoutContent = z.infer<typeof checkoutContentSchema>;

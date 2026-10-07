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
  /** Siparis akisi (T12.4): istek surerken dugme, basari ve inceleme bildirimleri. */
  placingLabel: contentTextSchema,
  orderPlacedToast: contentTextSchema,
  orderInReviewToast: contentTextSchema,
  /** "Sipariş Ver" pasifken altinda ilk eksik kosul (N1). */
  blockerGiftNotice: contentTextSchema,
  blockerAgreementNotice: contentTextSchema,
  blockerCardNotice: contentTextSchema,
  blockerAddressNotice: contentTextSchema,
  blockerMinBasketNotice: contentTextSchema,
  blockerClosedNotice: contentTextSchema,
  /** 3DS penceresi (T12.4; geri sayim T17.1: son 30 saniyede uyari). */
  threeDsTitle: contentTextSchema,
  threeDsDescription: contentTextSchema,
  threeDsCodeLabel: contentTextSchema,
  threeDsSubmitLabel: contentTextSchema,
  threeDsSubmittingLabel: contentTextSchema,
  threeDsCancelLabel: contentTextSchema,
  threeDsRemainingLabel: contentTextSchema,
  threeDsLastSecondsNotice: contentTextSchema,
  /** "2 deneme hakkın kaldı": sayinin arkasi. */
  threeDsAttemptsLeftSuffix: contentTextSchema,
  threeDsExpiredToast: contentTextSchema,
  threeDsCancelledToast: contentTextSchema,
  /**
   * "Ödeme Yöntemi Seç" penceresi (T17.1; F5): baslik, kart listesinin
   * basligi ("Online Ödeme"), secili kartin yanindaki "Kartı Sil", "Seç" ve
   * adimlarin geri oku. Kart adlari, silme onayi ve "Kart Ekle" metinleri
   * Odeme Yontemlerim'le ortak (paymentMethods).
   */
  methodDialogTitle: contentTextSchema,
  onlinePaymentTitle: contentTextSchema,
  deleteCardLabel: contentTextSchema,
  chooseLabel: contentTextSchema,
  backLabel: contentTextSchema,
  /**
   * Secili kayitli kart artik yok (POST /v1/orders 404, ayrinti resource
   * "card"; T12.4): siparis odeme bekler kalir, baska kartla yeniden verilir.
   */
  cardMissingNotice: contentTextSchema,
  /**
   * Erken rezervasyon (T12.4; PM K4): odeme ozetinde kalan sure ("Ürünlerin
   * 9:41 boyunca senin için ayrıldı."), istek surerken durum, son dakika notu,
   * sure dolunca sessiz yeniden ayirma bildirimi, hata satirinin dugmesi ve
   * "Sipariş Ver"in altindaki kosul cumlesi.
   */
  reservationHeldPrefix: contentTextSchema,
  reservationHeldSuffix: contentTextSchema,
  reservationPendingLabel: contentTextSchema,
  reservationLastMinuteNotice: contentTextSchema,
  reservationRenewedToast: contentTextSchema,
  reservationRetryLabel: contentTextSchema,
  blockerReservationNotice: contentTextSchema,
});

export type CheckoutContent = z.infer<typeof checkoutContentSchema>;

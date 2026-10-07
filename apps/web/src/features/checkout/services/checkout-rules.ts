/**
 * Odeme formunun kurallari (T17.1) - TASLAK (PM karari M3): siparis govdesinin
 * hediye ve not alanlari backend'de henuz yok (B2). Sinirlar ve cumleler burada
 * bekler; B1/B2 birlesince @getir/contracts'a tasinir ve gateway ayni kurali
 * uygular. Telefon kurali ve cumlesi bugun de sozlesmeden (PHONE_PATTERN).
 */

import { PHONE_MESSAGE, PHONE_PATTERN } from '@getir/contracts';

import { toE164 } from '../../auth/services/phone';

/** Hediye kartı notu ve siparis notu en fazla bu kadar karakter (B2 taslagi). */
export const CHECKOUT_TEXT_MAX = 250;
/** Gonderici ve alici adi en fazla bu kadar karakter (B2 taslagi). */
export const GIFT_NAME_MAX = 60;

export const RECIPIENT_NAME_MESSAGE = 'Alıcının adını yaz';

/** Hediye bilgileri: alici adi ve telefonu hediye acikken zorunludur. */
export interface GiftForm {
  readonly enabled: boolean;
  readonly message: string;
  readonly senderName: string;
  readonly recipientName: string;
  /** Ulke kodundan sonraki 10 rakam (PhoneField). */
  readonly recipientPhone: string;
}

export interface CheckoutForm {
  readonly gift: GiftForm;
  readonly note: string;
  readonly doNotRingBell: boolean;
  readonly agreementsAccepted: boolean;
}

export const EMPTY_CHECKOUT_FORM: CheckoutForm = {
  gift: { enabled: false, message: '', senderName: '', recipientName: '', recipientPhone: '' },
  note: '',
  doNotRingBell: false,
  agreementsAccepted: false,
};

export type GiftFieldErrors = Partial<Record<'recipientName' | 'recipientPhone', string>>;

/**
 * Hediye alanlarinin hatalari: hediye kapaliysa yok. Alici adi bosluktan ibaret
 * olamaz; telefon Turkiye cep numarasi olmali (giris ve kayitla ayni kural).
 */
export function giftFieldErrors(gift: GiftForm): GiftFieldErrors {
  if (!gift.enabled) {
    return {};
  }
  return {
    ...(gift.recipientName.trim() === '' ? { recipientName: RECIPIENT_NAME_MESSAGE } : {}),
    ...(PHONE_PATTERN.test(toE164(gift.recipientPhone)) ? {} : { recipientPhone: PHONE_MESSAGE }),
  };
}

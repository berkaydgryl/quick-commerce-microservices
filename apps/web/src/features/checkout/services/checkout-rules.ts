/**
 * Odeme formunun durumu ve hatalari (T17.1). Sinirlar ve cumleler sozlesmeden
 * (@getir/contracts checkout-rules: CHECKOUT_TEXT_MAX, GIFT_NAME_MAX,
 * giftDetailsSchema; B2): gateway ayni kurali uygular, istemci kopya tutmaz.
 */

import { giftDetailsSchema } from '@getir/contracts';

import { toE164 } from '../../auth/services/phone';

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

/** Formda hatasi gosterilen hediye alanlari (sinirlar alanin maxLength'iyle tutulur). */
const SHOWN_FIELDS: readonly (keyof GiftFieldErrors)[] = ['recipientName', 'recipientPhone'];

/**
 * Hediye alanlarinin hatalari: hediye kapaliysa yok. Kural ve cumle sozlesmenin
 * giftDetailsSchema'sindan (alici adi bosluktan ibaret olamaz, telefon E.164
 * cep numarasi): siparis govdesi de ayni semayla dogrulanir.
 */
export function giftFieldErrors(gift: GiftForm): GiftFieldErrors {
  if (!gift.enabled) {
    return {};
  }
  const parsed = giftDetailsSchema.safeParse({
    enabled: true,
    message: gift.message,
    senderName: gift.senderName,
    recipientName: gift.recipientName,
    recipientPhone: toE164(gift.recipientPhone),
  });
  const errors: { -readonly [Field in keyof GiftFieldErrors]: string } = {};
  for (const issue of parsed.error?.issues ?? []) {
    const field = SHOWN_FIELDS.find((name) => name === issue.path[0]);
    if (field !== undefined) {
      errors[field] ??= issue.message;
    }
  }
  return errors;
}

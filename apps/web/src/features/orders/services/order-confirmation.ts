/**
 * Siparis onay ekraninin kurallari (F17; saf). Baslik durumdan; odeme satiri
 * kart listesinden (S4 a); teslimat ayrintilari varsa (S3 a). Onay ekranina
 * giderken gezinme durumunda (adres degil) yalniz sonucun turu ve odenen kartin
 * kimligi tasinir: siparis okunamasa da baslik gorunur; siparis gorunumu karti
 * tasimaz (M7: yalniz cardId).
 *
 * Tablo durum tipinin TAMAMINI anahtar alir: ORDER_STATUS'a dugum eklenirse
 * derleme burada durur.
 */

import { cardIdSchema } from '@getir/contracts';
import type {
  CardBrandLabels,
  CheckoutContent,
  OrderDetailsView,
  OrderPaymentView,
  OrderStatus,
  SavedCard,
} from '@getir/contracts';
import { z } from 'zod';

import { cardShortName } from '../../cards/services/card-face';

import { paymentLabel } from './payment-label';
import type { PaymentLabelTexts } from './payment-label';

/** placed: "Siparişin alındı!"; review: "Siparişin inceleniyor"; other: onay degil (detaya). */
export type ConfirmationKind = 'placed' | 'review' | 'other';

const KIND: Readonly<Record<OrderStatus, ConfirmationKind>> = {
  DRAFT: 'other',
  RISK_CHECK: 'other',
  REVIEW: 'review',
  RESERVED: 'other',
  AWAITING_PAYMENT: 'other',
  PAID: 'placed',
  PREPARING: 'placed',
  ON_THE_WAY: 'placed',
  DELIVERED: 'placed',
  CANCELLED: 'other',
  REJECTED: 'other',
  PAYMENT_FAILED: 'other',
  EXPIRED: 'other',
};

export function confirmationKind(status: OrderStatus): ConfirmationKind {
  return KIND[status];
}

/** Tahmini varis suresi yalniz siparis yoldayken anlamli (verildi, hazirlaniyor, yolda). */
export function showsEstimate(status: OrderStatus): boolean {
  return confirmationKind(status) === 'placed' && status !== 'DELIVERED';
}

/** Ekranin basligi: verildi ya da incelemede. */
export type ConfirmationHeading = Exclude<ConfirmationKind, 'other'>;

/**
 * Baslik (ve ayrilma) karari: ekran bir kez basligini gosterdiyse (akistan
 * gelen sonuc ya da ilk okunan durum) yoklamada onay olmayan duruma gecen
 * siparis ekrandan atilmaz, son baslik kalir (durum etiketi gercegi soyler).
 * Hic baslik gosterilmeden onay olmayan durum okunursa (dogrudan adres,
 * iptal edilmis siparis) 'leave': siparis detayina gecilir.
 */
export function confirmationHeading(
  status: OrderStatus | undefined,
  shown: ConfirmationHeading | undefined,
): ConfirmationHeading | 'leave' | undefined {
  if (status === undefined) {
    return shown;
  }
  const kind = confirmationKind(status);
  return kind === 'other' ? (shown ?? 'leave') : kind;
}

const confirmationStateSchema = z.object({
  heading: z.enum(['placed', 'review']),
  cardId: cardIdSchema.optional(),
});

/** Onay ekranina gezinme durumu: sonucun turu ve (kartla odendiyse) kartin kimligi. */
export type ConfirmationState = z.infer<typeof confirmationStateSchema>;

export function confirmationState(
  heading: ConfirmationHeading,
  cardId: string | undefined,
): ConfirmationState {
  return cardId === undefined ? { heading } : { heading, cardId };
}

/** Gezinme durumu; bicim tutmazsa (eski kayit, baska sayfa, dogrudan adres) bos. */
export function confirmationFromState(state: unknown): Partial<ConfirmationState> {
  const parsed = confirmationStateSchema.safeParse(state);
  return parsed.success ? parsed.data : {};
}

/**
 * Odeme satiri (S4 a): kartla odendiyse ve kart listede varsa "Visa •••• 4242";
 * kart bilinmiyor ya da silinmisse yalniz "Kart" (hata yok). Kapida odemede
 * "Kapıda nakit" ya da "Kapıda kredi/banka kartı"; eski sipariste yok.
 */
export function confirmationPayment(input: {
  readonly payment: OrderPaymentView | undefined;
  readonly cardId: string | undefined;
  readonly cards: readonly SavedCard[] | undefined;
  readonly texts: PaymentLabelTexts;
  readonly brandLabels: CardBrandLabels;
}): string | undefined {
  const { payment, cardId, cards } = input;
  if (payment?.method !== 'CARD') {
    return paymentLabel(payment, input.texts);
  }
  const card = cardId === undefined ? undefined : cards?.find((item) => item.id === cardId);
  return card === undefined ? input.texts.paymentCardLabel : cardShortName(card, input.brandLabels);
}

export type DeliveryDetailTexts = Pick<
  CheckoutContent,
  'recipientNameLabel' | 'giftMessageLabel' | 'senderNameLabel' | 'noteLabel'
>;

export interface DetailRow {
  readonly label: string;
  readonly value: string;
}

/**
 * Teslimat ayrintilarinin satirlari (S3 a): hediyede alici, kart notu ve
 * gonderen (bos olan yazilmaz; alicinin telefonu onayda gerekmez, yazilmaz);
 * siparis notu. "Zili Çalma" ayri satirdir (deger degil isaret).
 */
export function deliveryDetailRows(
  details: OrderDetailsView | undefined,
  texts: DeliveryDetailTexts,
): readonly DetailRow[] {
  if (details === undefined) {
    return [];
  }
  const { gift } = details;
  const rows: [string, string | undefined][] = [
    [texts.recipientNameLabel, gift?.recipientName],
    [texts.giftMessageLabel, gift?.message],
    [texts.senderNameLabel, gift?.senderName],
    [texts.noteLabel, details.note],
  ];
  return rows.flatMap(([label, value]) =>
    value === undefined || value.trim() === '' ? [] : [{ label, value }],
  );
}

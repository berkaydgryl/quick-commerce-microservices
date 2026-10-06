/**
 * Kart kasasi domain -> sozlesme (proto) cevirisi (T11.17). Cevap MASKELIDIR:
 * saglayici jetonu, durum ve silme ani bilerek eslenmez. Marka eslemesi Record:
 * yeni marka eklendiginde eksik esleme DERLEMEDE yakalanir.
 */

import { isCardExpired } from '@getir/contracts';
import type { CardBrand } from '@getir/contracts';
import { cardvaultV1 } from '@getir/proto';

import type { Card } from '../../domain/card.js';

const BRAND_TO_PROTO: Readonly<Record<CardBrand, cardvaultV1.CardBrand>> = {
  VISA: cardvaultV1.CardBrand.CARD_BRAND_VISA,
  MASTERCARD: cardvaultV1.CardBrand.CARD_BRAND_MASTERCARD,
  AMEX: cardvaultV1.CardBrand.CARD_BRAND_AMEX,
  TROY: cardvaultV1.CardBrand.CARD_BRAND_TROY,
};

/** `now`: okuma ani; `expired` ona gore (Turkiye saatiyle) hesaplanir. */
export function toProtoSavedCard(card: Card, now: Date): cardvaultV1.SavedCard {
  return {
    id: card.id,
    brand: BRAND_TO_PROTO[card.brand],
    first4: card.first4,
    last4: card.last4,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    holderName: card.holderName,
    nickname: card.nickname ?? '',
    expired: isCardExpired(card.expiryMonth, card.expiryYear, now),
    createdAt: card.createdAt,
  };
}

export function toProtoSavedCards(cards: readonly Card[], now: Date): cardvaultV1.SavedCard[] {
  return cards.map((card) => toProtoSavedCard(card, now));
}

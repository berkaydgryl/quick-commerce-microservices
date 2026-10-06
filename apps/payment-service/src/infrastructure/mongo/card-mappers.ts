/**
 * Kart kasasi domain <-> Mongo belgesi cevirisi (T11.17). Istege bagli alanlar
 * (nickname, providerToken, deletedAt) yoksa belgeye HIC yazilmaz: geri okunan
 * kart yazilanla birebir esit olmali (exactOptionalPropertyTypes).
 */

import type { Card } from '../../domain/card.js';
import type { CardDocument } from './documents.js';

export function toCardDocument(card: Card): CardDocument {
  return {
    _id: card.id,
    userId: card.userId,
    brand: card.brand,
    first4: card.first4,
    last4: card.last4,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    holderName: card.holderName,
    ...(card.nickname === undefined ? {} : { nickname: card.nickname }),
    ...(card.providerToken === undefined ? {} : { providerToken: card.providerToken }),
    status: card.status,
    createdAt: card.createdAt,
    ...(card.deletedAt === undefined ? {} : { deletedAt: card.deletedAt }),
  };
}

export function fromCardDocument(document: CardDocument): Card {
  return {
    id: document._id,
    userId: document.userId,
    brand: document.brand,
    first4: document.first4,
    last4: document.last4,
    expiryMonth: document.expiryMonth,
    expiryYear: document.expiryYear,
    holderName: document.holderName,
    ...(document.nickname === undefined ? {} : { nickname: document.nickname }),
    ...(document.providerToken === undefined ? {} : { providerToken: document.providerToken }),
    status: document.status,
    createdAt: document.createdAt,
    ...(document.deletedAt === undefined ? {} : { deletedAt: document.deletedAt }),
  };
}

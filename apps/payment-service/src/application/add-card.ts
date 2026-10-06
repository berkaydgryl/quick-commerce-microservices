/**
 * AddCard use-case (T11.17): karti dogrular ve kullanicinin kasasina ekler.
 *
 * Akis: (1) son kullanma (zamana bagli kural; bicimi sema denetledi), (2) kasa
 * dolu mu, ayni kart var mi - saglayiciya gitmeden, (3) saglayicinin 0 TL
 * dogrulamasi, (4) maskeli kart depoya; depo (2)'yi ATOMIK olarak yeniden
 * denetler: es zamanli eklemeler sinirlari asamaz.
 *
 * KART NUMARASI VE CVV yalnizca bu fonksiyonun icinde ve saglayiciya giden
 * cagride vardir: maskelenir, saklanmaz, gunluge yazilmaz. Gunluk satirlari
 * yalnizca kart kimligi, kullanici ve marka tasir (ad ve kart adi da yok).
 */

import {
  cardBrandOf,
  cardExpiryProblem,
  CARD_FIELD_MESSAGES,
  normalizeCardNumber,
} from '@getir/contracts';
import type { CardBrand } from '@getir/contracts';
import { AppError, ID_PREFIX, newId } from '@getir/core';
import type { Clock, Logger } from '@getir/core';

import { CARD_STATUS, isSameCard, maskCardNumber } from '../domain/card.js';
import type { Card, CardKey } from '../domain/card.js';
import {
  cardAlreadySaved,
  cardExpiryRejected,
  cardVerificationDeclined,
  cardVerifierUnavailable,
  cardWalletFull,
} from '../domain/card-errors.js';
import type { CardRepository } from '../domain/card-repository.js';
import type { CardVerification, CardVerifier } from '../domain/card-verifier.js';

export interface AddCardDeps {
  readonly repository: CardRepository;
  readonly verifier: CardVerifier;
  readonly clock: Clock;
  /** Kullanici basina en fazla kart (SAVED_CARDS_MAX). */
  readonly maxCards: number;
}

/** Semadan (gRPC) gecmis istek: ad ve kart adi NFC ve kirpilmis, bos kart adi yok. */
export interface AddCardInput {
  readonly userId: string;
  readonly number: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
  readonly cvv: string;
  readonly holderName: string;
  readonly nickname?: string | undefined;
}

/** `logger` cagrinin gunlukcusudur (requestId ve rpc bagli; bkz. charge.ts). */
export type AddCard = (input: AddCardInput, logger: Logger) => Promise<Card>;

export function createAddCard(deps: AddCardDeps): AddCard {
  return async (input, logger) => {
    const now = deps.clock.date();
    const expiry = cardExpiryProblem(input.expiryMonth, input.expiryYear, now);
    if (expiry !== null) {
      throw cardExpiryRejected(expiry);
    }

    const digits = normalizeCardNumber(input.number);
    const brand = brandOf(digits);
    const key: CardKey = {
      userId: input.userId,
      ...maskCardNumber(digits),
      expiryMonth: input.expiryMonth,
      expiryYear: input.expiryYear,
    };
    await rejectIfUnsavable(deps, key);

    const verification = await verify(deps.verifier, { ...input, number: digits }, logger);
    if (verification.decision === 'DECLINED') {
      logger.info({ userId: input.userId, brand }, 'kart dogrulanamadi');
      throw cardVerificationDeclined();
    }

    const card: Card = {
      id: newId(ID_PREFIX.CARD),
      ...key,
      brand,
      holderName: input.holderName,
      ...(input.nickname === undefined ? {} : { nickname: input.nickname }),
      providerToken: verification.providerToken,
      status: CARD_STATUS.ACTIVE,
      createdAt: now,
    };
    await deps.repository.add(card, deps.maxCards);
    logger.info({ userId: input.userId, cardId: card.id, brand }, 'kart kaydedildi');
    return card;
  };
}

/** Sema bilinen markayi garanti eder; buraya bilinmeyen marka gelirse istek gecersizdir. */
function brandOf(digits: string): CardBrand {
  const brand = cardBrandOf(digits);
  if (brand === null) {
    throw AppError.validation('Gecersiz istek', { details: { number: CARD_FIELD_MESSAGES.brand } });
  }
  return brand;
}

/**
 * Kasa dolu ya da ayni kart kayitli mi? Saglayiciya gitmeden bakilir: kaydedilemeyecek
 * kart dogrulatilmaz. Kesin karar deponun atomik eklemesindedir (es zamanli istek).
 */
async function rejectIfUnsavable(deps: AddCardDeps, key: CardKey): Promise<void> {
  const cards = await deps.repository.listActive(key.userId);
  const same = cards.find((card) => isSameCard(card, key));
  if (same !== undefined) {
    throw cardAlreadySaved(same.id);
  }
  if (cards.length >= deps.maxCards) {
    throw cardWalletFull();
  }
}

/**
 * Saglayici cagrisi. Ulasilamazsa SERVICE_UNAVAILABLE. Asil hatanin yalnizca
 * TURU gunluge yazilir; mesaji ve yigin izi ne gunluge ne cevaba gider: gercek
 * bir saglayicinin hata metni numarayi yankilayabilir.
 */
async function verify(
  verifier: CardVerifier,
  input: AddCardInput & { readonly number: string },
  logger: Logger,
): Promise<CardVerification> {
  try {
    return await verifier.verifyCard({
      number: input.number,
      expiryMonth: input.expiryMonth,
      expiryYear: input.expiryYear,
      cvv: input.cvv,
    });
  } catch (error: unknown) {
    logger.warn(
      { userId: input.userId, errorType: error instanceof Error ? error.name : typeof error },
      'kart dogrulayicisina ulasilamadi',
    );
    throw cardVerifierUnavailable();
  }
}

/**
 * Kart kasasinin hatalari (T11.17). Yeni hata kodu yoktur: sozlesmedeki
 * (card_vault.proto) dort kod. Ayrintilar alan -> cumledir ve GIRILEN DEGERI
 * ICERMEZ: cumleler @getir/contracts CARD_FIELD_MESSAGES'tan gelir.
 */

import { CARD_FIELD_MESSAGES } from '@getir/contracts';
import type { CardExpiryProblem } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

/** Saglayici reddinin genel sebebi: hangi kontrolun tuttugu disari verilmez. */
export const CARD_VERIFICATION_DECLINED = 'verification_declined';

/** Kasa dolu: kullanicinin SAVED_CARDS_MAX karti var. */
export function cardWalletFull(): AppError {
  return AppError.validation('Kart kasasi dolu', {
    details: { cards: CARD_FIELD_MESSAGES.cards },
  });
}

/** Ayni kart kullanicinin kasasinda kayitli; ayrinti var olan kartin kimligi. */
export function cardAlreadySaved(cardId: string): AppError {
  return AppError.conflict('Kart zaten kayitli', { details: { cardId } });
}

/** Kart yok, baska kullanicinin ya da zaten silinmis: ucu de ayni cevap. */
export function cardNotFound(cardId: string): AppError {
  return AppError.notFound('Kart bulunamadi', { details: { cardId } });
}

export function cardExpiryRejected(problem: CardExpiryProblem): AppError {
  return AppError.validation('Gecersiz istek', {
    details: { [problem.field]: problem.message },
  });
}

/** Saglayici karti dogrulamadi (0 TL dogrulama). Kart kaydedilmez. */
export function cardVerificationDeclined(): AppError {
  return new AppError(ERROR_CODES.PAYMENT_DECLINED, 'Kart dogrulanamadi', {
    details: { reason: CARD_VERIFICATION_DECLINED },
  });
}

/**
 * Saglayiciya ulasilamadi. Asil hata BILEREK eklenmez (`cause` yok): pino'nun
 * `err` serilestiricisi cause'un mesajini ve yigin izini satira yazar, gercek
 * bir saglayicinin hata metni de karti yankilayabilir.
 */
export function cardVerifierUnavailable(): AppError {
  return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Kart dogrulayicisina ulasilamadi');
}

/**
 * Kart yazimi es zamanli bir yazimla cakisti ve sonuc okunamadi (QA D1).
 * Yeniden denenebilir; ayrinti tasimaz (depo hatasinin koleksiyon ve alan adlari
 * disari cikmaz).
 */
export function cardWriteContended(): AppError {
  return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Kart kaydi su an tamamlanamadi');
}

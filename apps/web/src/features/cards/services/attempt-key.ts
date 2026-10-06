/**
 * Kart ekleme denemesinin Idempotency-Key'i (T11.17, M7).
 *
 * Formlarin niyet anahtari (createIntentKeys) govdenin JSON'unu parmak izi
 * olarak bellekte tutar; kart govdesinde numara ve CVV var, orada
 * kullanilamaz. Bu anahtar RASTGELEDIR, govdeden turetilmez ve govdeyi
 * tutmaz. Kural:
 *   - sonucu belirsiz deneme (ag koptu, 503: SERVICE_UNAVAILABLE) ayni
 *     anahtarla tekrarlanir: sunucu kaydettiyse ikinci kart acilmaz;
 *   - sunucu cevap verdiyse (basari ya da ret) sonraki deneme yeni anahtar alir.
 */

import { AppError, ERROR_CODES } from '@getir/core';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';

export interface AttemptKeys {
  /** Bu denemenin anahtari. */
  readonly current: () => string;
  /** Deneme bitti; hata verdiyse hatayla (sonucu belirsizse anahtar korunur). */
  readonly settle: (error?: unknown) => void;
}

/** Sonucu bilinmeyen hata: istek sunucuya ulasip ulasmadigi belli degil. */
export function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.SERVICE_UNAVAILABLE;
}

export function createAttemptKeys(create: () => string = createIdempotencyKey): AttemptKeys {
  let key = create();
  return {
    current: () => key,
    settle: (error?: unknown) => {
      if (error === undefined || !isUnknownOutcome(error)) {
        key = create();
      }
    },
  };
}

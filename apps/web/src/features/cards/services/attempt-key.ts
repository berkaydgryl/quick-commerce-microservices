/**
 * Kart ekleme denemesinin Idempotency-Key'i (T11.17, M7).
 *
 * Formlarin niyet anahtari (createIntentKeys) govdenin JSON'unu parmak izi
 * olarak bellekte tutar; kart govdesinde numara ve CVV var, orada
 * kullanilamaz. Bu anahtar RASTGELEDIR, govdeden turetilmez ve govdeyi
 * tutmaz. Kural:
 *   - sonucu belirsiz deneme (ag koptu ya da 503: SERVICE_UNAVAILABLE; ayni
 *     anahtarla ilk istek hala suruyor: REQUEST_IN_PROGRESS, QA C1) ayni
 *     anahtarla tekrarlanir: sunucu kaydettiyse ikinci kart acilmaz;
 *   - sunucu cevap verdiyse (basari ya da ret) sonraki deneme yeni anahtar alir;
 *   - deneme surerken ya da belirsiz sonuctan sonra kullanici istegin bir
 *     alanini degistirirse (QA C3, D2) govde artik baska: yeni anahtar (eski
 *     anahtarla farkli govde 409 alirdi). "Kirli" bayragi istek giderken
 *     yapilan duzenlemeyi de tutar.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { ErrorCode } from '@getir/core';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';

export interface AttemptKeys {
  /** Deneme baslar: anahtar; govde formun o anki hali (kirli bayragi silinir). */
  readonly start: () => string;
  /** Deneme bitti; hata verdiyse hatayla (sonucu belirsizse ve govde degismediyse anahtar korunur). */
  readonly settle: (error?: unknown) => void;
  /** Istegin bir alani degisti: korunan anahtar birakilir; giden deneme kirli sayilir. */
  readonly changed: () => void;
}

/** Istegin sunucuya ulasip islenip islenmedigi belli olmayan hatalar. */
const UNKNOWN_OUTCOME: ReadonlySet<ErrorCode> = new Set([
  ERROR_CODES.SERVICE_UNAVAILABLE,
  ERROR_CODES.REQUEST_IN_PROGRESS,
]);

/** Sonucu bilinmeyen hata: ayni anahtarla tekrar denenmeli. */
export function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AppError && UNKNOWN_OUTCOME.has(error.code);
}

export function createAttemptKeys(create: () => string = createIdempotencyKey): AttemptKeys {
  let key = create();
  /** Anahtar belirsiz bir denemeden korunuyor. */
  let kept = false;
  /** Son deneme basladiktan sonra istegin bir alani degisti. */
  let dirty = false;
  const renew = () => {
    key = create();
    kept = false;
  };
  return {
    start: () => {
      dirty = false;
      return key;
    },
    settle: (error?: unknown) => {
      if (error !== undefined && isUnknownOutcome(error) && !dirty) {
        kept = true;
      } else {
        renew();
      }
    },
    changed: () => {
      dirty = true;
      if (kept) {
        renew();
      }
    },
  };
}

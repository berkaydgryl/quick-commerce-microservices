/**
 * Idempotency anahtari ureteci (ADR-08).
 *
 * Anahtar NIYET basina bir kez uretilir: "Siparisi tamamla"ya iki kez basmak
 * ayni anahtari gondermelidir. Bu yuzden mutasyon cagrisinin icinde degil,
 * niyetin basladigi yerde (form acilisi, sepet onayi) uretilip saklanir.
 */

import {
  IDEMPOTENCY_KEY_CHARSET,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '@getir/contracts';

/** Sozlesmenin anahtar kurali: uzunluk ve karakter kumesi (T8.2). */
const IDEMPOTENCY_KEY_PATTERN = new RegExp(
  `^[${IDEMPOTENCY_KEY_CHARSET}]{${IDEMPOTENCY_KEY_MIN_LENGTH},${IDEMPOTENCY_KEY_MAX_LENGTH}}$`,
);

/** Tarayicinin kriptografik UUID'si (v4, 36 karakter). */
export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Sozlesmenin kabul ettigi anahtar mi: 8-128 karakter, yalnizca harf, rakam,
 * '-' ve '_' (gateway ayni kurali uygular; bicimsiz anahtara 400 doner).
 */
export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(key);
}

/**
 * Idempotency anahtari ureteci (ADR-08).
 *
 * Anahtar NIYET basina bir kez uretilir: "Siparisi tamamla"ya iki kez basmak
 * ayni anahtari gondermelidir. Bu yuzden mutasyon cagrisinin icinde degil,
 * niyetin basladigi yerde (form acilisi, sepet onayi) uretilip saklanir.
 */

import { IDEMPOTENCY_KEY_MAX_LENGTH, IDEMPOTENCY_KEY_MIN_LENGTH } from '@getir/contracts';

/** Tarayicinin kriptografik UUID'si (v4, 36 karakter). */
export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Sozlesmenin kabul ettigi uzunlukta mi (gateway ayni siniri uygular). */
export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= IDEMPOTENCY_KEY_MIN_LENGTH && key.length <= IDEMPOTENCY_KEY_MAX_LENGTH;
}

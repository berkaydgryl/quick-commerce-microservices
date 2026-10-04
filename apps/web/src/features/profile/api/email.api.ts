/**
 * E-posta dogrulama uclari (T11.14): POST /v1/me/email/code ve
 * POST /v1/me/email/verify. Ikisi de korumali (yetkili istemciyle) ve kalici
 * bir sey degistirir: anahtar ister (ADR-08).
 */

import { emailCodeSentSchema, userProfileSchema } from '@getir/contracts';
import type {
  EmailCodeSent,
  SendEmailCodeRequest,
  UserProfile,
  VerifyEmailRequest,
} from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/**
 * Adrese 6 haneli kod gonderir; cevap kodun gecerliligi ve yeni kod icin
 * bekleme (saniye). Adres baska hesaptaysa ya da zaten bu hesaptaysa
 * VALIDATION_FAILED (email); bekleme bitmediyse RATE_LIMITED (retryAfterSeconds).
 */
export function sendEmailCode(
  client: HttpClient,
  request: SendEmailCodeRequest,
  idempotencyKey: string,
): Promise<EmailCodeSent> {
  return client.request('/v1/me/email/code', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: emailCodeSentSchema,
  });
}

/**
 * Kodu dogrular; cevap guncel profildir (email dolu). Yanlis, kilitli ya da
 * suresi dolmus kod VALIDATION_FAILED (code); cumle sunucudan gelir.
 */
export function verifyEmail(
  client: HttpClient,
  request: VerifyEmailRequest,
  idempotencyKey: string,
): Promise<UserProfile> {
  return client.request('/v1/me/email/verify', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: userProfileSchema,
  });
}

/**
 * Profil duzenleme uclari (T11.14 PR 3): PATCH /v1/me (ad, #89),
 * POST /v1/me/phone/code ve /verify (numara degistirme ve dogrulama). Hepsi
 * korumali (yetkili istemciyle) ve kalici bir sey degistirir: anahtar ister
 * (ADR-08). Telefon uclari production'da yoktur (gercek SMS #95).
 */

import { phoneCodeSentSchema, userProfileSchema } from '@getir/contracts';
import type {
  PhoneCodeSent,
  SendPhoneCodeRequest,
  UpdateProfileRequest,
  UserProfile,
  VerifyPhoneRequest,
} from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/** Adi degistirir; cevap guncel profil. Ad kurali kayittakiyle ayni. */
export function updateProfile(
  client: HttpClient,
  request: UpdateProfileRequest,
  idempotencyKey: string,
): Promise<UserProfile> {
  return client.request('/v1/me', {
    method: 'PATCH',
    idempotencyKey,
    body: request,
    schema: userProfileSchema,
  });
}

/**
 * Numaraya 6 haneli kod (SMS). Baska numaraya gecerken sifre gerekir: yanlissa
 * VALIDATION_FAILED (password); numara baska hesaptaysa PHONE_ALREADY_REGISTERED
 * (details.phone); bekleme bitmediyse RATE_LIMITED.
 */
export function sendPhoneCode(
  client: HttpClient,
  request: SendPhoneCodeRequest,
  idempotencyKey: string,
): Promise<PhoneCodeSent> {
  return client.request('/v1/me/phone/code', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: phoneCodeSentSchema,
  });
}

/**
 * Kodu dogrular; cevap guncel profil (phone yeni numara, phoneVerified true).
 * Numara degistiyse diger cihazlardaki oturumlar kapanir; bu oturum surer.
 */
export function verifyPhone(
  client: HttpClient,
  request: VerifyPhoneRequest,
  idempotencyKey: string,
): Promise<UserProfile> {
  return client.request('/v1/me/phone/verify', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: userProfileSchema,
  });
}

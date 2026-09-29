/**
 * Kimlik uclari (T8.5): kayit, giris, cikis ve profil. Yenileme oturum
 * cekirdegindedir (shared/session/session-api.ts): yetkili istemci de kullanir.
 */

import { authSessionSchema, logoutResultSchema, userProfileSchema } from '@getir/contracts';
import type {
  AuthSession,
  LoginRequest,
  LogoutResult,
  RegisterRequest,
  UserProfile,
} from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/** POST /v1/auth/register: hesap acar ve oturumu baslatir. Kalici kayit: anahtar ister (ADR-08). */
export function registerUser(
  client: HttpClient,
  request: RegisterRequest,
  idempotencyKey: string,
): Promise<AuthSession> {
  return client.request('/v1/auth/register', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: authSessionSchema,
  });
}

/** POST /v1/auth/login: yanlis telefon ya da sifre INVALID_CREDENTIALS (hangisi oldugu soylenmez). */
export function loginUser(client: HttpClient, request: LoginRequest): Promise<AuthSession> {
  return client.request('/v1/auth/login', {
    method: 'POST',
    session: true,
    body: request,
    schema: authSessionSchema,
  });
}

/** POST /v1/auth/logout: govdesiz; gateway cerezdeki jetonu iptal eder ve cerezi siler. */
export function logoutSession(client: HttpClient): Promise<LogoutResult> {
  return client.request('/v1/auth/logout', {
    method: 'POST',
    session: true,
    schema: logoutResultSchema,
  });
}

/** GET /v1/me: korumali; yetkili istemciyle cagrilir (erisim jetonu). */
export function fetchProfile(client: HttpClient, signal?: AbortSignal): Promise<UserProfile> {
  return client.request('/v1/me', { schema: userProfileSchema, signal });
}

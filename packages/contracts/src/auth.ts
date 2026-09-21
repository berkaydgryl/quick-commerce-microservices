/**
 * Kimlik uclarinin semalari: /v1/auth/register ve /v1/auth/login.
 *
 * Kimlik TELEFON + SIFRE ile kurulur (ADR-12). E-posta toplanmaz: SMS/OTP
 * altyapisi kurulmadigi icin dogrulanamayan bir alan kimlik alani olarak
 * kullanilamaz.
 */

import { z } from 'zod';

import { idSchema } from './common.js';
import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
} from './constants.js';

/** E.164 bicimi telefon; users.phone uzerinde unique indeks vardir. */
export const phoneSchema = z.string().regex(PHONE_PATTERN);

/**
 * Sifre.
 *
 * Ust sinir bcrypt'in 72 baytlik girdi sinirindan gelir: daha uzun bir sifre
 * sessizce kirpilir ve kullanici farkinda olmadan farkli bir sifre kaydetmis
 * olurdu.
 */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const registerRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  fullName: z.string().min(FULL_NAME_MIN_LENGTH).max(FULL_NAME_MAX_LENGTH),
});

export const loginRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
});

export const userProfileSchema = z.object({
  id: idSchema,
  phone: phoneSchema,
  fullName: z.string(),
});

export const authSessionSchema = z.object({
  accessToken: z.string(),
  /** Tek desteklenen tur; istemci basligi "Bearer <token>" olarak kurar. */
  tokenType: z.literal('Bearer').optional(),
  /** Saniye cinsinden omur (JWT_TTL). Bitis ani DEGIL, SURE tasinir. */
  expiresIn: z.number().int().positive(),
  user: userProfileSchema,
});

export type Phone = z.infer<typeof phoneSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;

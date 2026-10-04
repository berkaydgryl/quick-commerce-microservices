/**
 * Dogrulama kodu (T11.14): e-posta (email.ts) ve telefon (phone.ts) ayni 6
 * haneli kodu kullanir. Kurallar constants.ts'te (VERIFICATION_CODE_*);
 * gateway ayni kurali ayni cumleyle uygular (verification contract_test).
 */

import { z } from 'zod';

import { OTP_PATTERN } from './constants.js';

/** Kod bicimi kuralinin cumlesi: sunucu ve form ayni cumleyi gosterir. */
export const VERIFICATION_CODE_MESSAGE = 'Kod 6 rakam olmalı';

/** Dogrulama kodu: tam 6 rakam. */
export const verificationCodeSchema = z.string().regex(OTP_PATTERN, VERIFICATION_CODE_MESSAGE);

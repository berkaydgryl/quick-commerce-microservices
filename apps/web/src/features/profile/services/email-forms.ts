/**
 * E-posta penceresinin form semalari (T11.14). Kurallar ve cumleler
 * sozlesmeden (@getir/contracts email.ts); gateway ayni kurali ayni cumleyle
 * uygular (emailverify contract_test).
 */

import { emailCodeSchema, sendEmailCodeRequestSchema } from '@getir/contracts';
import { z } from 'zod';

/** Adres adimi: govde dogrudan istektir (adres kirpilir, kucuk harfe iner). */
export const emailFormSchema = sendEmailCodeRequestSchema;
export type EmailFormValues = z.input<typeof emailFormSchema>;
/** Sunucu hatasinin eslenebilecegi alanlar, ekrandaki sirayla. */
export const EMAIL_FORM_FIELDS = ['email'] as const;

/** Kod adimi: adres pencereden gelir, formda yalnizca kod var. */
export const codeFormSchema = z.object({ code: emailCodeSchema });
export type CodeFormValues = z.input<typeof codeFormSchema>;
/**
 * Kod adiminda sunucu iki alani soyleyebilir: kod (yanlis, kilitli, suresi
 * doldu) ve adres (bu arada baska hesapta dogrulandi). Adresin alani bu
 * formda yoktur: onun cumlesi formun ustunde gosterilir.
 */
export const CODE_FORM_FIELDS = ['code', 'email'] as const;

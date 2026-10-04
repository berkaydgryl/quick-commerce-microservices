/**
 * Kod adiminin kanaldan bagimsiz parcalari (T11.14 PR 3): metinler ve sunucu
 * hatasinin kod adimina dagitimi. E-posta (emailDialog) ve telefon
 * (phoneDialog) icerikleri ayni anahtarlari tasir.
 */

import type { EmailDialogContent } from '@getir/contracts';

/** Kod adiminin metinleri: iki kanalin iceriginde ayni anahtarlar. */
export type CodeStepTexts = Pick<
  EmailDialogContent,
  | 'codeSentToLabel'
  | 'codeFieldLabel'
  | 'verifyLabel'
  | 'verifyingLabel'
  | 'expiresInLabel'
  | 'expiredNotice'
  | 'resendLabel'
  | 'resendWaitLabel'
>;

/** Sunucu hatasinin kod adimindaki yeri: kod alaninin altinda ya da formun ustunde. */
export interface CodeStepFeedback {
  readonly code: string | undefined;
  readonly message: string | null;
}

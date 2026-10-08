/**
 * Dogrulama kodunun zaman penceresi (T11.14; PR 3'ten beri e-posta ve telefon
 * ortak): sunucu sureleri SANIYE olarak verir (emailCodeSentSchema,
 * phoneCodeSentSchema); istemci onlari cevabi aldigi andan baslatir. Saf
 * hesap: bilesen yalnizca "simdi"yi verir.
 */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Sunucunun gonderim cevabinin sure kismi (iki kanalda ayni). */
export interface CodeDurations {
  readonly expiresInSeconds: number;
  readonly resendAfterSeconds: number;
}

/** Kodun gonderildigi adres (e-posta ya da numara) ve iki sinir an (ms). */
export interface CodeWindow {
  readonly address: string;
  /** Kodun gecersiz oldugu an. */
  readonly expiresAt: number;
  /** Yeni kodun istenebildigi an. */
  readonly resendAt: number;
}

/** Sunucunun cevabindan pencere: sureler cevabin alindigi andan. */
export function codeWindow(address: string, sent: CodeDurations, receivedAt: number): CodeWindow {
  return {
    address,
    expiresAt: receivedAt + sent.expiresInSeconds * MS_PER_SECOND,
    resendAt: receivedAt + sent.resendAfterSeconds * MS_PER_SECOND,
  };
}

/** Sinira kalan TAM saniye (yukari yuvarlanir, en az 0): 0 "sure doldu" demektir. */
export function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / MS_PER_SECOND));
}

/**
 * "9:41", "0:05": dakika ve iki haneli saniye; bir saat ve ustu "1:00:00"
 * (429 beklemesi saatlerce surebilir; F15b).
 */
export function formatCountdown(seconds: number): string {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = String(seconds % SECONDS_PER_MINUTE).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Telefon alani (T8.5; T11.6'dan beri ulke kodu ayri seciciden gelir):
 * kullanici yalnizca koddan sonraki 10 rakami yazar ve alan onlari
 * "5XX XXX XX XX" duzeninde gosterir. Gateway'e sozlesmenin E.164 bicimi
 * gider: "+905321234567" (PHONE_PATTERN, bugun yalnizca +90).
 */

/** Varsayilan ulke kodu: profilde ve kayitli numarada gosterim (PHONE_PATTERN). */
export const PHONE_COUNTRY_PREFIX = '+90';

/** Onekten sonraki rakam sayisi (PHONE_PATTERN: +90 ve 10 rakam). */
export const NATIONAL_PHONE_LENGTH = 10;

/** Gosterimdeki gruplar: 3-3-2-2. */
const GROUP_ENDS = [3, 6, 8, 10] as const;

/**
 * Yazilan ya da yapistirilan metinden onekten sonraki rakamlar (en fazla 10).
 * Yapistirilan "+90 532 ..." ya da "0532 ..." da ayni 10 rakama iner: ulke kodu
 * ve yurt ici "0" oneki atilir.
 */
export function nationalDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length > NATIONAL_PHONE_LENGTH && digits.startsWith('90')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.slice(0, NATIONAL_PHONE_LENGTH);
}

/** "5321234567" -> "532 123 45 67"; eksik numara da ayni duzende ("532 12"). */
export function formatNationalPhone(digits: string): string {
  const groups: string[] = [];
  let start = 0;
  for (const end of GROUP_ENDS) {
    const group = digits.slice(start, end);
    if (group !== '') {
      groups.push(group);
    }
    start = end;
  }
  return groups.join(' ');
}

/** Formdaki rakamlar + ulke kodu -> sozlesmenin bicimi: "5321234567" -> "+905321234567". */
export function toE164(digits: string, dialCode: string = PHONE_COUNTRY_PREFIX): string {
  return `${dialCode}${digits}`;
}

/** "+905321234567" -> "5321234567": kayitli numarayla formu doldururken. */
export function fromE164(phone: string): string {
  return nationalDigits(
    phone.startsWith(PHONE_COUNTRY_PREFIX) ? phone.slice(PHONE_COUNTRY_PREFIX.length) : phone,
  );
}

/** Ulke koduyla gosterim: ("+90", "5321234567") -> "+90 532 123 45 67". */
export function formatWithDialCode(dialCode: string, digits: string): string {
  return `${dialCode} ${formatNationalPhone(digits)}`;
}

/** Profilde gosterim: "+905321234567" -> "+90 532 123 45 67". */
export function formatPhone(phone: string): string {
  return formatWithDialCode(PHONE_COUNTRY_PREFIX, fromE164(phone));
}

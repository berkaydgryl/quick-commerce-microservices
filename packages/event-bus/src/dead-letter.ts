/**
 * Olu olay kaydi (T7.4, ADR-16): bir grubun isleyemedigi olay
 * stream:events:dead'e gerekcesiyle yazilir, kaynak kayit onaylanir.
 *
 * Kayit olayin ORIJINAL alanlarini aynen tasir; boylece elle yeniden oynatmak,
 * `dead.` onekli alanlari atip kalanini stream:events'e XADD etmektir (README).
 * Ust veriler `dead.` onekiyle eklenir ki zarf alanlariyla karismasin.
 */

/** Olu olaylar akisinin tuttugu en fazla kayit (yaklasik, MAXLEN ~). */
export const EVENTS_DEAD_LETTER_MAX_LENGTH = 1_000;

/** Hata metni kaydi sisirmesin: ilk bu kadar karakter yazilir. */
export const DEAD_LETTER_ERROR_MAX_LENGTH = 500;

export const DEAD_LETTER_REASON = {
  /** Isleyici reddetti: tekrar denemek sonucu degistirmez (govde bozuk, kayit yok). */
  REJECTED: 'rejected',
  /** Gecici hata surdu ve deneme hakki bitti. */
  EXHAUSTED: 'max_deliveries',
  /** Kayit olay zarfina uymuyor: hicbir isleyiciye verilemez. */
  MALFORMED: 'malformed',
  /** Kayit islenmeden akistan kirpildi (MAXLEN): elde yalnizca kimligi var. */
  TRIMMED: 'trimmed',
} as const;

export type DeadLetterReason = (typeof DEAD_LETTER_REASON)[keyof typeof DEAD_LETTER_REASON];

const DEAD_FIELD_PREFIX = 'dead.';

export const DEAD_LETTER_FIELD = {
  /** stream:events'teki kaynak kaydin kimligi. */
  SOURCE_ID: `${DEAD_FIELD_PREFIX}sourceId`,
  GROUP: `${DEAD_FIELD_PREFIX}group`,
  CONSUMER: `${DEAD_FIELD_PREFIX}consumer`,
  REASON: `${DEAD_FIELD_PREFIX}reason`,
  /** Kac kez isleyiciye verildi. */
  ATTEMPTS: `${DEAD_FIELD_PREFIX}attempts`,
  ERROR: `${DEAD_FIELD_PREFIX}error`,
  /** Olu olaylara tasindigi an, ISO 8601 UTC. */
  AT: `${DEAD_FIELD_PREFIX}at`,
} as const;

export interface DeadLetter {
  readonly sourceId: string;
  readonly group: string;
  readonly consumer: string;
  readonly reason: DeadLetterReason;
  readonly attempts: number;
  readonly error: string;
  readonly at: Date;
}

/**
 * XADD icin alan listesi: orijinal alanlar + `dead.` ust verisi. Orijinalde
 * onceki bir olumden kalan `dead.` alanlari varsa (yeniden oynatilmis kayit)
 * atilir; kayitta her ust veri bir kez bulunur.
 */
export function toDeadLetterFields(
  original: readonly string[] | null,
  letter: DeadLetter,
): string[] {
  const kept: string[] = [];
  const source = original ?? [];
  for (let index = 0; index + 1 < source.length; index += 2) {
    const name = source[index] ?? '';
    if (!name.startsWith(DEAD_FIELD_PREFIX)) {
      kept.push(name, source[index + 1] ?? '');
    }
  }
  return [
    ...kept,
    DEAD_LETTER_FIELD.SOURCE_ID,
    letter.sourceId,
    DEAD_LETTER_FIELD.GROUP,
    letter.group,
    DEAD_LETTER_FIELD.CONSUMER,
    letter.consumer,
    DEAD_LETTER_FIELD.REASON,
    letter.reason,
    DEAD_LETTER_FIELD.ATTEMPTS,
    String(letter.attempts),
    DEAD_LETTER_FIELD.ERROR,
    letter.error.slice(0, DEAD_LETTER_ERROR_MAX_LENGTH),
    DEAD_LETTER_FIELD.AT,
    letter.at.toISOString(),
  ];
}

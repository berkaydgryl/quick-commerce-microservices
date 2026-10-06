/**
 * Gunlukte kart verisi gizleme (T11.17): IKINCI emniyet.
 *
 * Birinci kural kodun kendisindedir: kart kasasi istek nesnesini gunluge HIC
 * vermez (payment-service testleri). Bu ayar, biri yine de verirse satira kart
 * numarasi ve CVV dusmesin diye.
 *
 * DAR tutulur: `cvv` her zaman gizlenir (baska anlami yok); `number` yalnizca
 * DEGERI kart numarasina benziyorsa (bosluk ve tire atilinca 12-19 rakam)
 * gizlenir. Siparis numarasi, kapi numarasi ya da sayi tasiyan baska bir
 * `number` alani oldugu gibi kalir (testli).
 *
 * YOLLAR ACIKTIR, JOKER YOK (QA O1): jokerli yol (`*.cvv`) pino'nun gizleyicisinde
 * her ust alanin prototipli kopyasini yazar; URL ve Buffer tasiyan satir cagriyi
 * esli olarak firlatir, `err` disindaki hatanin mesaji bos cikar. Gizleme yalnizca
 * ANAHTAR ADINA bakar: listede olmayan sekilde (ornek `{ kart: { numara } }`)
 * verilen kart verisi gizlenmez; birinci kural (istek gunluge verilmez) bunun
 * icin vardir.
 */

/** Gizlenen degerin yerine yazilan metin. */
export const REDACTED = '[gizli]';

const CARD_NUMBER_LIKE = /^\d{12,19}$/;

const SECRET_FIELDS = ['cvv', 'number'] as const;

/** Kart verisinin dusebilecegi ust alanlar: kart, kasanin girdisi ve gRPC istegi. */
const CONTAINERS = ['card', 'input', 'request'] as const;

/** pino yollari: alanin kendisi ve bilinen ust alanlarin altinda (joker yok). */
export const LOG_REDACT_PATHS: readonly string[] = SECRET_FIELDS.flatMap((field) => [
  field,
  ...CONTAINERS.map((container) => `${container}.${field}`),
]);

function looksLikeCardNumber(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return false;
  }
  return CARD_NUMBER_LIKE.test(String(value).replace(/[\s-]/g, ''));
}

/** pino `censor`: yolun son parcasi `cvv` ise hep, `number` ise kart numarasiysa gizler. */
export function censorCardData(value: unknown, path: readonly string[]): unknown {
  if (path.at(-1) === 'cvv') {
    return REDACTED;
  }
  return looksLikeCardNumber(value) ? REDACTED : value;
}

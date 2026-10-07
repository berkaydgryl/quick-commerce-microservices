/**
 * Gunlukte kart verisi ve siparis ayrintisi gizleme (T11.17, T12.4): IKINCI emniyet.
 * Siparis ayrintilarinin kisisel verisi (T12.4): kuryeye not, hediye mesaji,
 * gonderici ve alici adi, alici telefonu. Birinci kural yine kodda: order
 * ayrintilari gunluge HIC vermez. Bu yollar her zaman gizlenir; ust duzey
 * `note` GIZLENMEZ (siparis durum notu, ornek RESERVATION_EXPIRED). Kapsam
 * bilerek dar: `order`, `response`, `payload` gibi kaplar ve diziler (joker yok)
 * gizlenmez - birinci kural bunlar icin vardir. Her yeni kap QA O1 sinirini
 * genisletir: kabin altindaki duz nesne olmayan deger (URL, hata) satirda
 * bozulur; `order` bu yuzden kap DEGILDIR (en sik anahtar adi).
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

/** Siparis ayrintisinin kisisel alanlari (T12.4), `details` altindaki yollar. */
const ORDER_DETAIL_FIELDS = [
  'note',
  'gift.message',
  'gift.senderName',
  'gift.recipientName',
  'gift.recipientPhone',
] as const;

/** Ayrintinin dusebilecegi yerler: kendisi, use-case girdisi, gRPC istegi. */
const ORDER_DETAIL_CONTAINERS = ['details', 'input.details', 'request.details'];

/** Hediye tek basina verilirse (ayrintisiz) de ayni alanlar. */
const GIFT_FIELDS = ORDER_DETAIL_FIELDS.filter((field) => field.startsWith('gift.'));

/** pino yollari: alanin kendisi ve bilinen ust alanlarin altinda (joker yok). */
export const LOG_REDACT_PATHS: readonly string[] = [
  ...SECRET_FIELDS.flatMap((field) => [
    field,
    ...CONTAINERS.map((container) => `${container}.${field}`),
  ]),
  ...ORDER_DETAIL_CONTAINERS.flatMap((container) =>
    ORDER_DETAIL_FIELDS.map((field) => `${container}.${field}`),
  ),
  ...GIFT_FIELDS,
];

function looksLikeCardNumber(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return false;
  }
  return CARD_NUMBER_LIKE.test(String(value).replace(/[\s-]/g, ''));
}

/**
 * pino `censor`: siparis ayrintisi ve hediye alanlari ile `cvv` her zaman,
 * `number` yalnizca kart numarasiysa gizlenir. Yalnizca LOG_REDACT_PATHS'teki
 * yollar buraya gelir.
 */
export function censorLogData(value: unknown, path: readonly string[]): unknown {
  if (path.includes('details') || path.includes('gift') || path.at(-1) === 'cvv') {
    return REDACTED;
  }
  return looksLikeCardNumber(value) ? REDACTED : value;
}

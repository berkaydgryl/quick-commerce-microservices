/**
 * Test metnindeki RASTGELE gurultuyu sabitler (T11.17, #132'nin titrek testi).
 *
 * Kisa bir sirri (CVV "9183") gunluk ya da iz metninde ararken rastgele bir
 * kimligin icinde tesadufi eslesme ("req_8b21ab37ec584a9183af1f3aa53152d7")
 * testi yanlis alarmla dusurur. Kural: 6 hane ve alti sir ham metinde
 * aranmaz; once bu fonksiyondan gecer.
 *
 * YALNIZCA bilinen rastgele bicimler maskelenir:
 *   - onekli kimlik: <onek>_<32 kucuk onaltilik> (req_, crd_, usr_, tds_ ...);
 *   - bilinen rastgele alanlarin degeri: sure, zaman, surec, makine adi, port,
 *     iz kimlikleri.
 * GENEL rakam ya da onaltilik dizisi MASKELENMEZ: sizan kart numarasi tamamen
 * rakamdir ve gorunur kalmalidir.
 */

/** Maskelenen kimligin yerine yazilan metin. */
export const MASKED_ID = '<kimlik>';

/** Maskelenen rastgele alan degerinin yerine yazilan metin. */
export const MASKED_VALUE = '<rastgele>';

const PREFIXED_ID = /\b[a-z]{2,8}_[0-9a-f]{32}\b/g;

/** Degeri her kosuda degisen alanlar (JSON anahtari). */
const RANDOM_FIELDS = ['durationMs', 'time', 'pid', 'hostname', 'port', 'traceId', 'spanId'];

const RANDOM_FIELD_VALUE = new RegExp(
  `"(${RANDOM_FIELDS.join('|')})":(?:"[^"]*"|-?[0-9][0-9.eE+-]*)`,
  'g',
);

export function withoutRandomNoise(text: string): string {
  return text
    .replace(PREFIXED_ID, MASKED_ID)
    .replace(RANDOM_FIELD_VALUE, (_match, field: string) => `"${field}":"${MASKED_VALUE}"`);
}

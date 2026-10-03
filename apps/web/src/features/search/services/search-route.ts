/**
 * Genel aramanin adresi (T9.6; T11.10'dan beri ust bardan): arama ana sayfada
 * `?ara=` parametresinde durur; yenileme, geri tusu ve paylasma korur. Ust
 * bardaki kutu ana sayfada bu parametreyi yazar, baska sayfada aramayi buraya
 * tasir.
 */

/** Genel aramanin sorgu parametresi. */
export const SEARCH_PARAM = 'ara';

/** Sonuclarin gosterildigi sayfa: ana sayfa. */
export const SEARCH_PATH = '/';

/** Aramanin sonuc adresi: "/?ara=s%C3%BCt". */
export function searchHref(query: string): string {
  return `${SEARCH_PATH}?${new URLSearchParams({ [SEARCH_PARAM]: query }).toString()}`;
}

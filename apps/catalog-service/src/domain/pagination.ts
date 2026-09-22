/**
 * Sayfalama kurallari (saf).
 *
 * Sozlesme (getir.common.v1.PageRequest) iki seyi yaziya dokuyor:
 *   - 0 veya negatif page_size -> VARSAYILAN uygulanir,
 *   - ust sinirdan buyuk deger REDDEDILMEZ, sessizce KIRPILIR.
 * Kural burada tek yerde duruyor; hem katalog hem ileride siparis listesi
 * ayni davranisi gostersin diye.
 *
 * IMLEC (cursor) NEDEN OFFSET DEGIL: katalog siralamasi stok, kampanya ve
 * populerlikle degisir; offset ile ikinci sayfa istendiginde liste kaymis
 * olabilir ve ayni urun iki kez gorunur. Imlec "en son gordugun kimlik"
 * bilgisidir; kayitlar kimlige gore sirali oldugu icin sonraki sayfa
 * "kimligi bundan buyuk olanlar" ile deterministik bicimde bulunur. Ayni
 * mantik Mongo'da `_id > token` sorgusuna birebir cevrilir (mongo/product-repository.ts).
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Istenen sayfa boyutunu sozlesmedeki sinirlara oturtur. */
export function normalizePageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.trunc(requested), MAX_PAGE_SIZE);
}

export interface PageSlice<T> {
  readonly items: readonly T[];
  /** Bos ise liste bitmistir. */
  readonly nextPageToken: string;
}

/**
 * Kimlige gore SIRALI bir listeden tek sayfa keser.
 * @param token Onceki sayfanin son kimligi; ilk sayfada bos.
 */
export function sliceByCursor<T extends { readonly id: string }>(
  sorted: readonly T[],
  pageSize: number,
  token: string,
): PageSlice<T> {
  const start = token === '' ? 0 : sorted.findIndex((item) => item.id > token);
  if (start === -1) {
    // Imlec son kaydin otesinde: liste bitmis demektir.
    return { items: [], nextPageToken: '' };
  }

  const items = sorted.slice(start, start + pageSize);
  const last = items.at(-1);
  const hasMore = start + items.length < sorted.length;

  return { items, nextPageToken: hasMore && last !== undefined ? last.id : '' };
}

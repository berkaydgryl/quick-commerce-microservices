/**
 * Market sayfasinin adresi ve sorgu parametreleri tek yerde: sayfa bunlari
 * okur, baglanti kuranlar (yakindaki marketler, genel arama) bunlarla yazar.
 */

import { matchPath } from 'react-router-dom';

/** Yakindaki marketler listesi (T11.12) ve market sayfasinin rota deseni. */
export const MARKET_LIST_PATH = '/markets';
export const MARKET_ROUTE = `${MARKET_LIST_PATH}/:marketId`;

/** Market sayfasinin adreste duran secimleri: kategori ve arama (T9.5). */
export const MARKET_PARAMS = {
  category: 'kategori',
  search: 'ara',
} as const;

/**
 * Market listesinin adreste duran secimi (T11.12): dukkan turu, kucuk harf
 * ("?tur=kasap"). Geri tusu bir onceki suzgece doner; adres paylasilabilir.
 */
export const MARKET_LIST_PARAMS = {
  storeType: 'tur',
} as const;

/**
 * Market sayfasinin adresi. Arama verilirse sayfa o aramayla acilir: genel
 * aramadaki "+N urun daha" market sayfasini ayni aramayla acar (T9.6).
 */
export function marketPath(marketId: string, search?: string): string {
  const path = `/markets/${encodeURIComponent(marketId)}`;
  return search === undefined
    ? path
    : `${path}?${new URLSearchParams({ [MARKET_PARAMS.search]: search }).toString()}`;
}

/** Adres bir market sayfasiysa marketin kimligi (F16: "Evet"ten sonra kalinacak mi). */
export function marketIdInPath(pathname: string): string | undefined {
  return matchPath(MARKET_ROUTE, pathname)?.params['marketId'];
}

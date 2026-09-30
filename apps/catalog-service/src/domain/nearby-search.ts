/**
 * Genel arama kurali (T9.6, saf): markete girmeden, konuma hizmet veren
 * marketlerde urun ya da market adi.
 *
 *   - Market adi sorguyla eslesen market listelenir, urun eslesmesi olmasa da
 *     ("Market ya da Urun ara"). Ad eslesmesi urun aramasiyla ayni kuraldadir:
 *     her kelime adda gecmeli, harf ve Turkce karakter duyarsiz.
 *   - Urunu eslesen market listelenir; hicbiri olmayan market listede yoktur.
 *   - SIRA MESAFEDIR (30 Eylul karari; fiyat degil: farkli urunler arasinda
 *     gramaj farki yaniltir). ACIK marketler once, yakindan uzaga; KAPALI
 *     marketler en sonda, yine yakindan uzaga ("Kapali" rozetiyle gosterilir).
 */

import type { Market, Offer } from './catalog.js';
import { searchKey, searchWords } from './catalog.js';
import type { MarketDistance } from './market-coverage.js';
import type { MarketOfferMatches } from './offer-reader.js';

/** Genel aramada bir marketin sonucu. */
export interface NearbySearchResult {
  readonly market: MarketDistance;
  readonly marketNameMatched: boolean;
  /** Eslesen aktif teklifler, en fazla MAX_SEARCH_OFFERS_PER_MARKET. */
  readonly offers: readonly Offer[];
  readonly totalOfferMatches: number;
}

/** Market adi sorgunun her kelimesini iceriyor mu (harf ve Turkce karakter duyarsiz)? */
export function marketNameMatches(market: Market, query: string): boolean {
  const name = searchKey(market.name);
  const words = searchWords(query);
  return words.length > 0 && words.every((word) => name.includes(word));
}

/**
 * Sonuclar: eslesen marketler, acik olanlar once, her grup yakindan uzaga.
 *
 * @param markets Konumu kapsayan marketler, yakindan uzaga (coveringMarkets).
 * @param matches Bu marketlerdeki teklif eslesmeleri (searchActiveOffers).
 */
export function buildNearbySearchResults(
  markets: readonly MarketDistance[],
  matches: readonly MarketOfferMatches[],
  query: string,
): readonly NearbySearchResult[] {
  const byMarket = new Map(matches.map((match) => [match.marketId, match]));
  const results = markets
    .map((candidate): NearbySearchResult => {
      const match = byMarket.get(candidate.market.id);
      return {
        market: candidate,
        marketNameMatched: marketNameMatches(candidate.market, query),
        offers: match?.offers ?? [],
        totalOfferMatches: match?.totalMatches ?? 0,
      };
    })
    .filter((result) => result.marketNameMatched || result.totalOfferMatches > 0);
  return [
    ...results.filter((result) => result.market.market.isOpen),
    ...results.filter((result) => !result.market.market.isOpen),
  ];
}

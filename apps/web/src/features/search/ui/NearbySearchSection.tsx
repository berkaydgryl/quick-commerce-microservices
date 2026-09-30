import type { GeoPoint, SearchResult } from '@getir/contracts';
import type { ReactNode } from 'react';

import { QueryEmpty, QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useNearbySearch } from '../hooks/useNearbySearch';

import styles from './Search.module.css';

interface NearbySearchSectionProps {
  readonly location: GeoPoint;
  /** Gecerli arama (searchQueryFrom'dan gecmis): kirpilmis, en az 2 karakter. */
  readonly query: string;
  /**
   * Bir sonucun karti. Arama market satirini ve sepeti TANIMAZ: karti sayfa
   * kurar (SearchResultCard + market satiri + urunler), baglanti orada.
   */
  readonly renderResult: (result: SearchResult) => ReactNode;
}

/**
 * Genel arama sonuclari (T9.6) - TASARIMSIZ KABUK: sorgu durumuna gore
 * yukleniyor, hata, bos ya da liste. Sira sunucunundur: acik marketler
 * yakindan uzaga, kapalilar sonda (mesafe; fiyat degil).
 */
export function NearbySearchSection({ location, query, renderResult }: NearbySearchSectionProps) {
  const { data: results, error, isPending, refetch } = useNearbySearch(location, query);

  return (
    <section
      className={styles['c-search-results']}
      aria-labelledby="arama-sonuclari-baslik"
      aria-busy={isPending}
    >
      <h2 id="arama-sonuclari-baslik" className={styles['c-search-results__title']}>
        Arama sonuçları
      </h2>

      {isPending && <QueryLoading>Aranıyor…</QueryLoading>}
      {error !== null && <QueryError error={error} onRetry={() => void refetch()} />}
      {results !== undefined && results.length === 0 && (
        <QueryEmpty>“{query}” için market ya da ürün bulunamadı.</QueryEmpty>
      )}
      {results !== undefined && results.length > 0 && (
        <ul className={styles['c-search-results__list']} role="list">
          {results.map((result) => (
            <li key={result.market.id}>{renderResult(result)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

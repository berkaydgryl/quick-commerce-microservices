import type { SearchResult } from '@getir/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { hiddenProductCount } from '../services/search-result';

import styles from './Search.module.css';

interface SearchResultCardProps {
  readonly result: SearchResult;
  /** Market satiri: markets ozelligi cizer, sayfa verir. */
  readonly marketLine: ReactNode;
  /** Urun satirlari ve sepet dugmeleri: sayfa baglar. Yalnizca adi eslesen markette cizilmez. */
  readonly products: ReactNode;
  /** "+N urun daha" baglantisinin adresi: market sayfasi, ayni aramayla. */
  readonly moreHref: string;
}

/**
 * Genel arama karti (T9.6) - TASARIMSIZ KABUK: market satiri, market basina en
 * fazla 3 urun ve fazlasi icin "+N urun daha". Yalnizca adi eslesen markette
 * urun satiri yoktur. Kapali market listede kalir ("Kapali" rozeti market
 * satirinda); kart tasarimi kullanicinindir (T16.2).
 */
export function SearchResultCard({
  result,
  marketLine,
  products,
  moreHref,
}: SearchResultCardProps) {
  const hidden = hiddenProductCount(result);

  return (
    <article
      className={`${styles['c-search-result']} ${result.market.isOpen ? '' : styles['is-closed']}`}
    >
      {marketLine}
      {result.products.length > 0 && products}
      {hidden > 0 && (
        <Link
          to={moreHref}
          className={styles['c-search-result__more']}
          aria-label={`${result.market.name}: ${hidden} ürün daha`}
        >
          +{hidden} ürün daha
        </Link>
      )}
    </article>
  );
}

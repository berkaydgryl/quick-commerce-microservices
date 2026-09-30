import { useSearchParams } from 'react-router-dom';

import { searchQueryFrom } from '../../features/catalog/services/search-query';
import { CategorySection } from '../../features/catalog/ui/CategorySection';
import { MarketSearchBox } from '../../features/catalog/ui/MarketSearchBox';
import { DEFAULT_DELIVERY_LOCATION } from '../../features/markets/constants';
import { marketPath } from '../../features/markets/routes';
import { NearbyMarketLine } from '../../features/markets/ui/NearbyMarketLine';
import { NearbySearchSection } from '../../features/search/ui/NearbySearchSection';
import { SearchResultCard } from '../../features/search/ui/SearchResultCard';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import styles from './HomePage.module.css';
import { SearchResultProducts } from './SearchResultProducts';

/** Genel arama adreste durur (T9.6): yenileme, geri tusu ve paylasma korur. */
const SEARCH_PARAM = 'ara';

/**
 * Ilk ekran: logo, "Market ya da Urun ara" kutusu (T9.6) ve kategori seridi.
 * Arama varken seridin yerinde sonuclar durur; temizlenince serit doner.
 * Konum, adres secimi (T9.5 PR 2) gelene kadar sabit "Ev" adresidir.
 *
 * Sayfa BIRLESTIRIR: arama karti market satirini ve sepeti tanimaz; karti
 * market satiri (markets), urunler ve sepet dugmeleri (catalog + cart) ile
 * burada kurar.
 */
export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchQueryFrom(searchParams.get(SEARCH_PARAM) ?? '');

  const search = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [SEARCH_PARAM]: next }, { replace: true });
  };

  return (
    <PageLayout brandIsTitle>
      <div className={styles['c-home-page']}>
        <MarketSearchBox
          query={query}
          onSearch={search}
          label="Market ya da ürün ara"
          placeholder="Market ya da Ürün ara…"
        />
        {query === undefined ? (
          <CategorySection />
        ) : (
          <NearbySearchSection
            location={DEFAULT_DELIVERY_LOCATION}
            query={query}
            renderResult={(result) => (
              <SearchResultCard
                result={result}
                marketLine={<NearbyMarketLine nearby={result} />}
                products={<SearchResultProducts result={result} />}
                moreHref={marketPath(result.market.id, query)}
              />
            )}
          />
        )}
      </div>
    </PageLayout>
  );
}

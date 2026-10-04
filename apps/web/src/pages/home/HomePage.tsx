import { useSearchParams } from 'react-router-dom';

import { useDeliveryLocation } from '../../features/address/hooks/useDeliveryLocation';
import { searchQueryFrom } from '../../features/catalog/services/search-query';
import { marketPath } from '../../features/markets/routes';
import { NearbyMarketLine } from '../../features/markets/ui/NearbyMarketLine';
import { SEARCH_PARAM } from '../../features/search/services/search-route';
import { NearbySearchSection } from '../../features/search/ui/NearbySearchSection';
import { SearchResultCard } from '../../features/search/ui/SearchResultCard';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';
import { MarketListingScreen } from '../markets/MarketListingScreen';

import styles from './HomePage.module.css';
import { SearchResultProducts } from './SearchResultProducts';

/**
 * Ilk ekran: market listesi (T11.12; solda dukkan turleri, ortada kartlar,
 * sagda Sepetim; urun kategorileri seridi kalkti). Arama kutusu ve teslimat
 * adresi ust bardadir (T11.10): arama `?ara=`'ya yazilir, varken listenin
 * yerinde sonuclar durur; temizlenince geri doner. Marketler ve arama secili
 * adresin konumuyla sorulur; adres degisince hemen yenilenir.
 *
 * Sayfa BIRLESTIRIR: arama karti market satirini ve sepeti tanimaz; karti
 * market satiri (markets), urunler ve sepet dugmeleri (catalog + cart) ile
 * burada kurar.
 */
export function HomePage() {
  const [searchParams] = useSearchParams();
  const location = useDeliveryLocation();
  const query = searchQueryFrom(searchParams.get(SEARCH_PARAM) ?? '');

  return (
    <PageLayout brandIsTitle>
      <div className={styles['c-home-page']}>
        {query === undefined ? (
          <MarketListingScreen headingLevel={2} />
        ) : (
          <NearbySearchSection
            location={location}
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

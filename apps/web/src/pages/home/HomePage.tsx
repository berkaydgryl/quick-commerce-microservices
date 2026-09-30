import { useLocation, useSearchParams } from 'react-router-dom';

import { useDeliveryLocation } from '../../features/address/hooks/useDeliveryLocation';
import { AddressSelector } from '../../features/address/ui/AddressSelector';
import { loginPathFor } from '../../features/auth/services/next-path';
import { searchQueryFrom } from '../../features/catalog/services/search-query';
import { CategorySection } from '../../features/catalog/ui/CategorySection';
import { MarketSearchBox } from '../../features/catalog/ui/MarketSearchBox';
import { marketPath } from '../../features/markets/routes';
import { NearbyMarketLine } from '../../features/markets/ui/NearbyMarketLine';
import { NearbyMarketsSection } from '../../features/markets/ui/NearbyMarketsSection';
import { NearbySearchSection } from '../../features/search/ui/NearbySearchSection';
import { SearchResultCard } from '../../features/search/ui/SearchResultCard';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import styles from './HomePage.module.css';
import { SearchResultProducts } from './SearchResultProducts';

/** Genel arama adreste durur (T9.6): yenileme, geri tusu ve paylasma korur. */
const SEARCH_PARAM = 'ara';

/**
 * Ilk ekran: logo, teslimat adresi (T9.5), "Market ya da Urun ara" kutusu
 * (T9.6), kategori seridi ve yakindaki marketler. Arama varken serit ve
 * marketlerin yerinde sonuclar durur; temizlenince geri doner. Marketler ve
 * arama secili adresin konumuyla sorulur; adres degisince hemen yenilenir.
 *
 * Sayfa BIRLESTIRIR: arama karti market satirini ve sepeti tanimaz; karti
 * market satiri (markets), urunler ve sepet dugmeleri (catalog + cart) ile
 * burada kurar. Adres secici de giris adresini buradan alir (auth).
 */
export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const loginHref = loginPathFor(useLocation());
  const location = useDeliveryLocation();
  const query = searchQueryFrom(searchParams.get(SEARCH_PARAM) ?? '');

  const search = (next: string | undefined): void => {
    setSearchParams(next === undefined ? {} : { [SEARCH_PARAM]: next }, { replace: true });
  };

  return (
    <PageLayout brandIsTitle>
      <div className={styles['c-home-page']}>
        <AddressSelector loginHref={loginHref} />
        <MarketSearchBox
          query={query}
          onSearch={search}
          label="Market ya da ürün ara"
          placeholder="Market ya da Ürün ara…"
        />
        {query === undefined ? (
          <>
            <CategorySection />
            <NearbyMarketsSection location={location} headingLevel={2} />
          </>
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

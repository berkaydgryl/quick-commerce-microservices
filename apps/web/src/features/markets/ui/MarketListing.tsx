import type { GeoPoint, MarketListContent, StoreType } from '@getir/contracts';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useNearbyMarkets } from '../hooks/useNearbyMarkets';
import { MARKET_LIST_PARAMS } from '../routes';
import { storeTypeFromParam, storeTypeToParam } from '../services/store-type-filter';

import styles from './MarketListing.module.css';
import { MarketListingView } from './MarketListingView';

interface MarketListingProps {
  /** Teslimat konumu; henuz yoksa (adres cozuluyor) liste "yukleniyor" gosterir. */
  readonly location: GeoPoint | undefined;
  /** Metinler; icerik gelene kadar undefined (yer tutucu). */
  readonly content: MarketListContent | undefined;
  readonly headingLevel: 1 | 2;
  readonly aside: ReactNode;
}

/**
 * Market listesinin verisi (T11.12): yakindaki marketler (sunucu verisi,
 * TanStack Query) ve adresteki dukkan turu suzgeci (?tur=kasap). Secim
 * gecmise yazilir: geri tusu bir onceki suzgece doner.
 */
export function MarketListing({ location, content, headingLevel, aside }: MarketListingProps) {
  const { data, error, refetch } = useNearbyMarkets(location);
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = storeTypeFromParam(searchParams.get(MARKET_LIST_PARAMS.storeType));

  const select = (type: StoreType | undefined): void => {
    setSearchParams(
      type === undefined ? {} : { [MARKET_LIST_PARAMS.storeType]: storeTypeToParam(type) },
    );
  };

  if (content === undefined) {
    return <div className={styles['c-market-listing__placeholder']} aria-busy="true" />;
  }
  return (
    <MarketListingView
      content={content}
      markets={data}
      error={error}
      onRetry={() => void refetch()}
      selected={selected}
      onSelect={select}
      headingLevel={headingLevel}
      aside={aside}
    />
  );
}

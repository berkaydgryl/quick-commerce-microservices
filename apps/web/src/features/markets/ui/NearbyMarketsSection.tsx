import type { GeoPoint } from '@getir/contracts';

import { QueryEmpty, QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useNearbyMarkets } from '../hooks/useNearbyMarkets';

import styles from './Markets.module.css';
import { NearbyMarketList } from './NearbyMarketList';

interface NearbyMarketsSectionProps {
  /** Teslimat konumu; henuz yoksa (adres cozuluyor) bolum "yukleniyor" gosterir. */
  readonly location: GeoPoint | undefined;
  /** /markets'ta sayfanin ana basligi (1); ana sayfada logonun altinda (2). */
  readonly headingLevel?: 1 | 2;
}

/** Yakindaki marketler bolumu: sorgu durumuna gore yukleniyor, hata, bos ya da liste. */
export function NearbyMarketsSection({ location, headingLevel = 1 }: NearbyMarketsSectionProps) {
  const { data: markets, error, isPending, refetch } = useNearbyMarkets(location);
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <section
      className={styles['c-markets']}
      aria-labelledby="marketler-baslik"
      aria-busy={isPending}
    >
      <Heading id="marketler-baslik" className={styles['c-markets__title']}>
        Yakındaki Marketler
      </Heading>

      {isPending && <QueryLoading>Marketler yükleniyor…</QueryLoading>}
      {error !== null && <QueryError error={error} onRetry={() => void refetch()} />}
      {markets !== undefined && markets.length === 0 && (
        <QueryEmpty>Bölgende şu an hizmet veren market yok.</QueryEmpty>
      )}
      {markets !== undefined && markets.length > 0 && <NearbyMarketList markets={markets} />}
    </section>
  );
}

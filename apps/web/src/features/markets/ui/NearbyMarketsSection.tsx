import type { GeoPoint } from '@getir/contracts';

import { QueryEmpty, QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useNearbyMarkets } from '../hooks/useNearbyMarkets';

import styles from './Markets.module.css';
import { NearbyMarketList } from './NearbyMarketList';

/** Yakindaki marketler bolumu: sorgu durumuna gore yukleniyor, hata, bos ya da liste. */
export function NearbyMarketsSection({ location }: { readonly location: GeoPoint }) {
  const { data: markets, error, isPending, refetch } = useNearbyMarkets(location);

  return (
    <section
      className={styles['c-markets']}
      aria-labelledby="marketler-baslik"
      aria-busy={isPending}
    >
      <h1 id="marketler-baslik" className={styles['c-markets__title']}>
        Yakındaki Marketler
      </h1>

      {isPending && <QueryLoading>Marketler yükleniyor…</QueryLoading>}
      {error !== null && <QueryError error={error} onRetry={() => void refetch()} />}
      {markets !== undefined && markets.length === 0 && (
        <QueryEmpty>Bölgende şu an hizmet veren market yok.</QueryEmpty>
      )}
      {markets !== undefined && markets.length > 0 && <NearbyMarketList markets={markets} />}
    </section>
  );
}

import { QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useMarket } from '../hooks/useMarket';

import styles from './Markets.module.css';
import { MarketSummary } from './MarketSummary';

/** Market basligi bolumu. Olmayan market NOT_FOUND ile hata olarak gorunur. */
export function MarketSummarySection({ marketId }: { readonly marketId: string }) {
  const { data: market, error, isPending, refetch } = useMarket(marketId);

  return (
    <section className={styles['c-markets']} aria-busy={isPending} aria-label="Market bilgisi">
      {isPending && <QueryLoading>Market yükleniyor…</QueryLoading>}
      {error !== null && <QueryError error={error} onRetry={() => void refetch()} />}
      {market !== undefined && <MarketSummary market={market} />}
    </section>
  );
}

import type { Market, MarketListContent, MarketPageContent } from '@getir/contracts';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useMarket } from '../hooks/useMarket';

import { MarketAboutDialog } from './MarketAboutDialog';
import { MarketHero } from './MarketHero';

interface MarketHeroSectionProps {
  readonly marketId: string;
  readonly pageTexts: MarketPageContent;
  readonly listTexts: MarketListContent;
  /** Puanin yanindaki eylem (favori kalbi); sayfa verir. */
  readonly renderAction?: (market: Market) => ReactNode;
}

/**
 * Magaza sayfasinin basi (T16.2): marketi okur, yuklenirken ve hatada durumu
 * gosterir, "Hakkında" penceresinin acik olup olmadigini tutar. Olmayan market
 * NOT_FOUND ile hata olarak gorunur (T5.4'ten beri yalnizca burada).
 */
export function MarketHeroSection({
  marketId,
  pageTexts,
  listTexts,
  renderAction,
}: MarketHeroSectionProps) {
  const { data: market, error, isPending, refetch } = useMarket(marketId);
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <section aria-busy={isPending} aria-label={pageTexts.infoLabel}>
      {isPending && <QueryLoading>{pageTexts.loadingLabel}</QueryLoading>}
      {error !== null && <QueryError error={error} onRetry={() => void refetch()} />}
      {market !== undefined && (
        <>
          <MarketHero
            market={market}
            pageTexts={pageTexts}
            listTexts={listTexts}
            action={renderAction?.(market)}
            onAbout={() => setAboutOpen(true)}
          />
          {aboutOpen && (
            <MarketAboutDialog
              market={market}
              texts={pageTexts}
              onClose={() => setAboutOpen(false)}
            />
          )}
        </>
      )}
    </section>
  );
}

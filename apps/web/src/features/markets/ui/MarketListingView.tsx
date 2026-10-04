import type { MarketListContent, NearbyMarket, StoreType } from '@getir/contracts';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { QueryEmpty, QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import {
  countByStoreType,
  filterByStoreType,
  storeTypeGroups,
} from '../services/store-type-filter';

import { MarketCard } from './MarketCard';
import styles from './MarketListing.module.css';
import { StoreTypeChips } from './StoreTypeChips';
import { StoreTypeMenu } from './StoreTypeMenu';

export interface MarketListingViewProps {
  readonly content: MarketListContent;
  /** Yakindaki marketler; sorgu bitene kadar undefined. */
  readonly markets: readonly NearbyMarket[] | undefined;
  readonly error: Error | null;
  readonly onRetry: () => void;
  readonly selected: StoreType | undefined;
  readonly onSelect: (type: StoreType | undefined) => void;
  /** Liste basliginin duzeyi: ana sayfada logo h1 oldugu icin 2, /markets'ta 1. */
  readonly headingLevel: 1 | 2;
  /** Sag sutun: Sepetim (sayfa yerlestirir; bu ozellik sepeti tanimaz). */
  readonly aside: ReactNode;
}

/**
 * Market listesi (T11.12; referans getircarsi): genis ekranda uc sutun
 * (1:2:1) - solda gruplu dukkan turleri, ortada "N isletme listeleniyor" ve
 * kartlar, sagda Sepetim. Tablet ve telefonda menunun yerine cip satiri;
 * Sepetim'in yerine sayfanin alttaki sepet cubugu. Liste yakindan uzaga.
 */
export function MarketListingView({
  content,
  markets,
  error,
  onRetry,
  selected,
  onSelect,
  headingLevel,
  aside,
}: MarketListingViewProps) {
  const menuTitleId = useId();
  const countId = useId();
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const groups = storeTypeGroups(content, countByStoreType(markets ?? []));
  const visible = markets === undefined ? undefined : filterByStoreType(markets, selected);

  return (
    <div className={styles['c-market-listing']}>
      <nav className={styles['c-market-listing__menu']} aria-labelledby={menuTitleId}>
        <h2 id={menuTitleId} className={styles['c-market-listing__title']}>
          {content.categoriesTitle}
        </h2>
        <StoreTypeMenu groups={groups} selected={selected} onSelect={onSelect} />
      </nav>

      <section
        className={styles['c-market-listing__main']}
        aria-labelledby={visible === undefined ? undefined : countId}
        aria-busy={markets === undefined && error === null}
      >
        <div className={styles['c-market-listing__chips']}>
          <StoreTypeChips
            label={content.categoriesTitle}
            allLabel={content.allLabel}
            entries={groups.flatMap((group) => group.types)}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
        {visible !== undefined && (
          <div className={styles['c-market-listing__header']}>
            <Heading id={countId} className={styles['c-market-listing__title']}>
              <span className={styles['c-market-listing__count']}>{visible.length}</span>{' '}
              {content.countLabel}
            </Heading>
            {selected !== undefined && (
              <button
                type="button"
                className={styles['c-market-listing__clear']}
                onClick={() => onSelect(undefined)}
              >
                {content.clearFilterLabel}
              </button>
            )}
          </div>
        )}

        {visible === undefined && error === null && (
          <QueryLoading>{content.loadingLabel}</QueryLoading>
        )}
        {error !== null && markets === undefined && <QueryError error={error} onRetry={onRetry} />}
        {markets !== undefined && markets.length === 0 && (
          <QueryEmpty>{content.emptyNotice}</QueryEmpty>
        )}
        {markets !== undefined && markets.length > 0 && visible?.length === 0 && (
          <QueryEmpty>{content.filterEmptyNotice}</QueryEmpty>
        )}
        {visible !== undefined && visible.length > 0 && (
          <ul className={styles['c-market-listing__list']} role="list">
            {visible.map((nearby) => (
              <MarketCard
                key={nearby.market.id}
                nearby={nearby}
                content={content}
                nameLevel={headingLevel === 1 ? 'h2' : 'h3'}
              />
            ))}
          </ul>
        )}
      </section>

      <aside className={styles['c-market-listing__aside']}>{aside}</aside>
    </div>
  );
}

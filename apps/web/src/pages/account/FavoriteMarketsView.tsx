import type {
  FavoriteMarketList,
  FavoritesContent,
  Market,
  MarketListContent,
} from '@getir/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { removedFavorite } from '../../features/favorites/services/favorite-list';
import { MarketCard } from '../../features/markets/ui/MarketCard';
import { QueryError, QueryLoading } from '../../shared/ui/query-status/QueryStatus';

import styles from './FavoriteMarketsView.module.css';

export interface FavoriteMarketsViewProps {
  readonly texts: FavoritesContent;
  /** Kart etiketleri (puan, min. tutar, Kapali): market listesiyle ayni. */
  readonly listTexts: MarketListContent;
  /** Favoriler; sorgu bitene kadar undefined. */
  readonly list: FavoriteMarketList | undefined;
  readonly error: Error | null;
  readonly onRetry: () => void;
  /** Kartin kapagindaki kalp (sayfa verir). */
  readonly renderAction: (market: Market) => ReactNode;
}

/**
 * "Favori Isletmelerim" (T11.13; referans getircarsi): baslik ve market
 * listesindeki kartin aynisi, kapakta dolu kalp. Kalbe basinca market hemen
 * listeden cikar (iyimser). Bos listede kisa aciklama.
 *
 * Kart cikinca (QA W2): basilan kalp kartla birlikte silindigi icin odak
 * sayfanin basina duserdi; odak bir sonraki kartin kalbine, yoksa basliga
 * tasinir ve ekran okuyucu "… favorilerden çıkarıldı" der (metin icerikten).
 */
export function FavoriteMarketsView({
  texts,
  listTexts,
  list,
  error,
  onRetry,
  renderAction,
}: FavoriteMarketsViewProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previous = useRef<FavoriteMarketList | undefined>(list);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const before = previous.current;
    previous.current = list;
    if (before === undefined || list === undefined) {
      return;
    }
    const removed = removedFavorite(
      before.items.map((item) => item.market.id),
      list.items.map((item) => item.market.id),
    );
    if (removed === undefined) {
      return;
    }
    const name = before.items[removed.index]?.market.name ?? '';
    setAnnouncement(`${name} ${texts.removedNotice}`);
    // Odak kaybolduysa (kalp kartla silindi): bir sonraki kartin kalbi, yoksa baslik.
    if (document.activeElement === null || document.activeElement === document.body) {
      const next = listRef.current?.children[removed.index];
      const heart = next?.querySelector<HTMLElement>('button[aria-pressed]');
      (heart ?? titleRef.current)?.focus();
    }
  }, [list, texts.removedNotice]);

  return (
    <section
      className={styles['c-favorite-markets']}
      aria-labelledby={titleId}
      aria-busy={list === undefined && error === null}
    >
      <h1 id={titleId} ref={titleRef} tabIndex={-1} className={styles['c-favorite-markets__title']}>
        {texts.title}
      </h1>
      <p className={styles['c-favorite-markets__announcer']} role="status" aria-live="polite">
        {announcement}
      </p>
      {list === undefined && error === null && <QueryLoading>{texts.loadingLabel}</QueryLoading>}
      {list === undefined && error !== null && <QueryError error={error} onRetry={onRetry} />}
      {list !== undefined && list.items.length === 0 && (
        <div className={styles['c-favorite-markets__empty']}>
          <p className={styles['c-favorite-markets__empty-title']}>{texts.emptyTitle}</p>
          <p className={styles['c-favorite-markets__empty-hint']}>{texts.emptyHint}</p>
        </div>
      )}
      {list !== undefined && list.items.length > 0 && (
        <ul ref={listRef} className={styles['c-favorite-markets__list']} role="list">
          {list.items.map((item) => (
            <MarketCard
              key={item.market.id}
              market={item.market}
              content={listTexts}
              nameLevel="h2"
              action={renderAction(item.market)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

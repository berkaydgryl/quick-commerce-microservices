import type { Market, MarketListContent, MarketPageContent } from '@getir/contracts';
import type { ReactNode } from 'react';

import { formatDeliveryTime, formatMoney, formatRating } from '../../../shared/services/format';
import { ChevronRightIcon } from '../../cart/ui/icons';

import { StarIcon } from './icons';
import { MarketBadge } from './MarketBadge';
import styles from './MarketHero.module.css';
import { RatingStars } from './RatingStars';

export type MarketHeroPageTexts = Pick<MarketPageContent, 'openLabel' | 'aboutLabel'>;
export type MarketHeroListTexts = Pick<
  MarketListContent,
  | 'ratingLabel'
  | 'ratingCountLabel'
  | 'minBasketLabel'
  | 'freeDeliveryThresholdLabel'
  | 'closedLabel'
>;

interface MarketHeroProps {
  readonly market: Market;
  readonly pageTexts: MarketHeroPageTexts;
  /** Puan, "Min.", "Kapalı" ve esik: market kartiyla ayni metinler (marketList). */
  readonly listTexts: MarketHeroListTexts;
  /** Puanin yanindaki eylem (favori kalbi); sayfa verir: markets favorileri tanimaz. */
  readonly action?: ReactNode;
  readonly onAbout: () => void;
}

/**
 * Magaza sayfasinin basi (T16.2; referans getircarsi isletme sayfasi): ustte
 * kapak ve sol ortasinda marka kutusu (MarketBadge: logo ya da bas harf), altta bilgi karti:
 * ad, yildizlar, puan ve favori; teslimat suresi ve minimum sepet; acik ya da
 * kapali ve "Hakkında"; ucretsiz teslimat rozeti. Kapanis saati verisi yok
 * (B3): yerine durum yazilir. Durumsuz.
 */
export function MarketHero({ market, pageTexts, listTexts, action, onAbout }: MarketHeroProps) {
  const { pricingRules } = market;

  return (
    <div className={styles['c-market-hero']}>
      <div className={styles['c-market-hero__media']}>
        {market.coverUrl !== undefined && (
          <img className={styles['c-market-hero__cover']} src={market.coverUrl} alt="" />
        )}
        <MarketBadge brand={market.brand} logoUrl={market.logoUrl} size="hero" />
      </div>
      <div className={styles['c-market-hero__body']}>
        <div className={styles['c-market-hero__top']}>
          <h1 className={styles['c-market-hero__name']}>{market.name}</h1>
          <div className={styles['c-market-hero__score']}>
            <RatingStars average={market.rating.average} />
            <span className={styles['c-market-hero__rating']}>
              <span className={styles['c-market-hero__star']}>
                <StarIcon />
              </span>
              <span className={styles['c-market-hero__sr']}>{listTexts.ratingLabel} </span>
              {formatRating(market.rating.average)}{' '}
              <span className={styles['c-market-hero__count']}>
                ({market.rating.count}
                <span className={styles['c-market-hero__sr']}> {listTexts.ratingCountLabel}</span>)
              </span>
            </span>
            {action}
          </div>
        </div>
        <div className={styles['c-market-hero__details']}>
          <p className={styles['c-market-hero__delivery']}>
            {formatDeliveryTime(market.deliveryTime)} · {listTexts.minBasketLabel}{' '}
            {formatMoney(pricingRules.minBasket)}
          </p>
          <div className={styles['c-market-hero__links']}>
            <span
              className={
                market.isOpen
                  ? styles['c-market-hero__status']
                  : `${styles['c-market-hero__status']} ${styles['c-market-hero__status--closed']}`
              }
            >
              {market.isOpen ? pageTexts.openLabel : listTexts.closedLabel}
            </span>
            <button type="button" className={styles['c-market-hero__about']} onClick={onAbout}>
              {pageTexts.aboutLabel}
              <span className={styles['c-market-hero__chevron']}>
                <ChevronRightIcon />
              </span>
            </button>
          </div>
        </div>
        <ul className={styles['c-market-hero__tags']} role="list">
          <li className={styles['c-market-hero__tag']}>
            {formatMoney(pricingRules.freeDeliveryThreshold)} {listTexts.freeDeliveryThresholdLabel}
          </li>
        </ul>
      </div>
    </div>
  );
}

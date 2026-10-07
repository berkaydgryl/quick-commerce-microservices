import type { Market, MarketListContent } from '@getir/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { formatDeliveryTime, formatMoney, formatRating } from '../../../shared/services/format';
import { marketPath } from '../routes';

import { StarIcon } from './icons';
import { MarketBadge } from './MarketBadge';
import styles from './MarketCard.module.css';

interface MarketCardProps {
  readonly market: Market;
  readonly content: MarketListContent;
  /** Market adinin baslik duzeyi: liste basligi h1 ise h2, h2 ise h3. */
  readonly nameLevel: 'h2' | 'h3';
  /**
   * Kapagin sag ust kosesindeki eylem (T11.13: favori kalbi). Sayfa verir:
   * markets ozelligi favorileri tanimaz.
   */
  readonly action?: ReactNode;
}

/**
 * Market karti (T11.12; referans getircarsi): solda kapak ve sol ortasinda
 * marka kutusu (MarketBadge: logo ya da bas harf), sagda ad, puan, sure, minimum sepet
 * ve ucretsiz teslimat esigi. Kapali market soluk ve "Kapali" etiketli, yine
 * tiklanabilir (market sayfasi kapali oldugunu soyler).
 *
 * Kartin tamami market sayfasina gider ama baglanti market adidir; uzerine
 * serilen katman (::after) karti tiklanabilir yapar. Eylem (kalp) baglantinin
 * DISINDA ve katmanin ustundedir: baglanti icinde dugme gecersiz HTML olurdu.
 */
export function MarketCard({ market, content, nameLevel: Name, action }: MarketCardProps) {
  const className = market.isOpen
    ? styles['c-market-card']
    : `${styles['c-market-card']} ${styles['is-closed']}`;

  return (
    <li className={className}>
      <div className={styles['c-market-card__surface']}>
        <div className={styles['c-market-card__media']}>
          {market.coverUrl !== undefined && (
            <img
              className={styles['c-market-card__cover']}
              src={market.coverUrl}
              alt=""
              width={640}
              height={360}
              loading="lazy"
            />
          )}
          <MarketBadge brand={market.brand} logoUrl={market.logoUrl} size="card" />
          {action !== undefined && <div className={styles['c-market-card__action']}>{action}</div>}
        </div>
        <div className={styles['c-market-card__body']}>
          <div className={styles['c-market-card__top']}>
            <Name className={styles['c-market-card__name']}>
              <Link to={marketPath(market.id)} className={styles['c-market-card__link']}>
                {market.name}
              </Link>
            </Name>
            <span className={styles['c-market-card__rating']}>
              <span className={styles['c-market-card__star']}>
                <StarIcon />
              </span>
              <span className={styles['c-market-card__sr']}>{content.ratingLabel} </span>
              {formatRating(market.rating.average)}
              <span className={styles['c-market-card__rating-count']}>
                ({market.rating.count}
                <span className={styles['c-market-card__sr']}> {content.ratingCountLabel}</span>)
              </span>
            </span>
          </div>
          <p className={styles['c-market-card__meta']}>
            {formatDeliveryTime(market.deliveryTime)} · {content.minBasketLabel}{' '}
            {formatMoney(market.pricingRules.minBasket)}
          </p>
          <ul className={styles['c-market-card__tags']} role="list">
            {!market.isOpen && (
              <li
                className={`${styles['c-market-card__tag']} ${styles['c-market-card__tag--closed']}`}
              >
                {content.closedLabel}
              </li>
            )}
            <li className={styles['c-market-card__tag']}>
              {formatMoney(market.pricingRules.freeDeliveryThreshold)}{' '}
              {content.freeDeliveryThresholdLabel}
            </li>
          </ul>
        </div>
      </div>
    </li>
  );
}

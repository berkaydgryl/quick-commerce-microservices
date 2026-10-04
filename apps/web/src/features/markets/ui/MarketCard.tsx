import type { MarketListContent, NearbyMarket } from '@getir/contracts';
import { Link } from 'react-router-dom';

import { formatDeliveryTime, formatMoney, formatRating } from '../../../shared/services/format';
import { marketPath } from '../routes';
import { marketInitials } from '../services/market-initials';

import { StarIcon } from './icons';
import styles from './MarketCard.module.css';

interface MarketCardProps {
  readonly nearby: NearbyMarket;
  readonly content: MarketListContent;
  /** Market adinin baslik duzeyi: liste basligi h1 ise h2, h2 ise h3. */
  readonly nameLevel: 'h2' | 'h3';
}

/**
 * Market karti (T11.12; referans getircarsi): solda kapak ve uzerinde bas
 * harf rozeti (logo yok, T11.11 karari), sagda ad, puan, sure, minimum sepet
 * ve ucretsiz teslimat esigi. Kapali market soluk ve "Kapali" etiketli, yine
 * tiklanabilir (market sayfasi kapali oldugunu soyler). Kartin tamami market
 * sayfasina baglantidir. Favori, gorunum dugmeleri ve indirim yok (karar 4).
 */
export function MarketCard({ nearby, content, nameLevel: Name }: MarketCardProps) {
  const { market } = nearby;
  const className = market.isOpen
    ? styles['c-market-card']
    : `${styles['c-market-card']} ${styles['is-closed']}`;

  return (
    <li className={className}>
      <Link to={marketPath(market.id)} className={styles['c-market-card__link']}>
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
          <span className={styles['c-market-card__badge']} aria-hidden="true">
            {marketInitials(market.brand)}
          </span>
        </div>
        <div className={styles['c-market-card__body']}>
          <div className={styles['c-market-card__top']}>
            <Name className={styles['c-market-card__name']}>{market.name}</Name>
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
      </Link>
    </li>
  );
}

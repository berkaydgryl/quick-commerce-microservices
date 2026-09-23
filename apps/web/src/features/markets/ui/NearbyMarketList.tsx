import type { NearbyMarket } from '@getir/contracts';
import { Link } from 'react-router-dom';

import {
  formatDeliveryTime,
  formatDistance,
  formatMoney,
  formatRating,
} from '../../../shared/services/format';

import styles from './Markets.module.css';

/**
 * Yakindaki marketler listesi - TASARIMSIZ KABUK (T5.4). Yalnizca veriyi
 * okunur sirayla gosterir; kart tasarimi kullanicinindir (T16.2).
 */
export function NearbyMarketList({ markets }: { readonly markets: readonly NearbyMarket[] }) {
  return (
    <ul className={styles['c-market-list']} role="list">
      {markets.map(({ market, distanceMeters }) => (
        <li
          key={market.id}
          className={`${styles['c-market-list__item']} ${market.isOpen ? '' : styles['is-closed']}`}
        >
          <Link
            to={`/markets/${encodeURIComponent(market.id)}`}
            className={styles['c-market-list__link']}
          >
            <span className={styles['c-market-list__name']}>{market.name}</span>
            {!market.isOpen && <span className={styles['c-market-list__badge']}>Kapalı</span>}
          </Link>
          <p className={styles['c-market-list__meta']}>
            ⭐ {formatRating(market.rating.average)} ({market.rating.count} değerlendirme) ·{' '}
            {formatDistance(distanceMeters)} · {formatDeliveryTime(market.deliveryTime)} · Min.{' '}
            {formatMoney(market.pricingRules.minBasket)}
          </p>
        </li>
      ))}
    </ul>
  );
}

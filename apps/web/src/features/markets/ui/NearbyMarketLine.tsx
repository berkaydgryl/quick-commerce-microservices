import type { NearbyMarket } from '@getir/contracts';
import { Link } from 'react-router-dom';

import {
  formatDeliveryTime,
  formatDistance,
  formatMoney,
  formatRating,
} from '../../../shared/services/format';
import { Badge } from '../../../shared/ui/badge/Badge';
import { marketPath } from '../routes';

import styles from './NearbyMarketLine.module.css';

/**
 * Yakindaki market satiri - TASARIMSIZ KABUK (T5.4): ad (market sayfasina
 * baglanti), "Kapali" rozeti, puan, mesafe, sure ve minimum sepet. Yakindaki
 * marketler listesi ve genel arama karti (T9.6) AYNI satiri kullanir; kart
 * tasarimi kullanicinindir (T16.2).
 */
export function NearbyMarketLine({ nearby }: { readonly nearby: NearbyMarket }) {
  const { market, distanceMeters } = nearby;

  return (
    <div className={styles['c-market-line']}>
      <Link to={marketPath(market.id)} className={styles['c-market-line__link']}>
        <span>{market.name}</span>
        {!market.isOpen && <Badge>Kapalı</Badge>}
      </Link>
      <p className={styles['c-market-line__meta']}>
        ⭐ {formatRating(market.rating.average)} ({market.rating.count} değerlendirme) ·{' '}
        {formatDistance(distanceMeters)} · {formatDeliveryTime(market.deliveryTime)} · Min.{' '}
        {formatMoney(market.pricingRules.minBasket)}
      </p>
    </div>
  );
}

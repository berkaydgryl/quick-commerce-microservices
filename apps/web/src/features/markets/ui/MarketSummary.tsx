import type { Market } from '@getir/contracts';

import { formatDeliveryTime, formatMoney, formatRating } from '../../../shared/services/format';
import { Badge } from '../../../shared/ui/badge/Badge';

import styles from './Markets.module.css';

/**
 * Market sayfasi basligi - TASARIMSIZ KABUK (T5.4): ad, puan, sure ve sepet
 * kurallari. Kurallar sunucudan gelir (ADR-15); burada hesap yapilmaz.
 * Kart gorunumu cevreleyen bolumden (c-markets) gelir; kok eleman stil tasimaz.
 * Baska blogun sinifi kullanilmaz (D11): baslik kendi, rozet ortak Badge.
 */
export function MarketSummary({ market }: { readonly market: Market }) {
  const { pricingRules } = market;

  return (
    <div>
      <h1 className={styles['c-market-summary__title']}>
        {market.name}
        {!market.isOpen && <Badge>Kapalı</Badge>}
      </h1>
      <dl className={styles['c-market-summary__facts']}>
        <dt>Puan</dt>
        <dd>
          ⭐ {formatRating(market.rating.average)} ({market.rating.count} değerlendirme)
        </dd>
        <dt>Ort. teslimat süresi</dt>
        <dd>{formatDeliveryTime(market.deliveryTime)}</dd>
        <dt>Min. tutar</dt>
        <dd>{formatMoney(pricingRules.minBasket)}</dd>
        <dt>Teslimat ücreti</dt>
        <dd>
          {formatMoney(pricingRules.deliveryFee)} ({formatMoney(pricingRules.freeDeliveryThreshold)}{' '}
          üzeri ücretsiz)
        </dd>
      </dl>
    </div>
  );
}

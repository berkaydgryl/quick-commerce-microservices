import type { Market } from '@getir/contracts';

import { formatDeliveryTime, formatMoney, formatRating } from '../../../shared/services/format';

import styles from './Markets.module.css';

/**
 * Market sayfasi basligi - TASARIMSIZ KABUK (T5.4): ad, puan, sure ve sepet
 * kurallari. Kurallar sunucudan gelir (ADR-15); burada hesap yapilmaz.
 */
export function MarketSummary({ market }: { readonly market: Market }) {
  const { pricingRules } = market;

  return (
    <div className={styles['c-market-summary']}>
      <h1 className={styles['c-markets__title']}>
        {market.name}
        {!market.isOpen && <span className={styles['c-market-list__badge']}>Kapalı</span>}
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

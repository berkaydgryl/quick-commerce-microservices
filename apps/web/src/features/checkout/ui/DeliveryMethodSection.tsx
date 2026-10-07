import type { CheckoutContent, Market, MarketListContent } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import type { CartTotals } from '@getir/pricing';
import { useId } from 'react';

import { formatDeliveryTime, formatMoney } from '../../../shared/services/format';
import { SectionCard } from '../../../shared/ui/section-card/SectionCard';

import styles from './DeliveryMethodSection.module.css';

interface DeliveryMethodSectionProps {
  readonly market: Market;
  readonly totals: CartTotals | undefined;
  readonly texts: Pick<CheckoutContent, 'deliveryTitle' | 'deliveryFeeLabel' | 'freeDeliveryLabel'>;
  readonly listTexts: Pick<MarketListContent, 'minBasketLabel'>;
}

/**
 * Teslimat Yontemi (T17.1; referans getircarsi): tek secenek, secili radyo:
 * "20-30 dk · Teslimat ücreti 19,90 TL · Min. 100,00 TL" (ucretsizse
 * "Ücretsiz Teslimat"). Etiketsiz (K4): kuryeyi platform atar.
 */
export function DeliveryMethodSection({
  market,
  totals,
  texts,
  listTexts,
}: DeliveryMethodSectionProps) {
  const id = useId();
  const fee =
    totals === undefined
      ? undefined
      : totals.deliveryFeeMinor === 0
        ? texts.freeDeliveryLabel
        : `${texts.deliveryFeeLabel} ${formatMoney({ amountMinor: totals.deliveryFeeMinor, currency: CURRENCY })}`;
  const parts = [
    formatDeliveryTime(market.deliveryTime),
    fee,
    `${listTexts.minBasketLabel} ${formatMoney(market.pricingRules.minBasket)}`,
  ].filter((part) => part !== undefined);

  return (
    <SectionCard title={texts.deliveryTitle}>
      <label className={styles['c-delivery-method']} htmlFor={id}>
        <input
          id={id}
          type="radio"
          className={styles['c-delivery-method__radio']}
          checked
          readOnly
        />
        <span>{parts.join(' · ')}</span>
      </label>
    </SectionCard>
  );
}

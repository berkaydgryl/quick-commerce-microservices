import type { Market, MarketPageContent } from '@getir/contracts';

import { formatDeliveryTime, formatMoney } from '../../../shared/services/format';
import { Dialog } from '../../../shared/ui/dialog/Dialog';

import styles from './MarketAboutDialog.module.css';

export type MarketAboutTexts = Pick<
  MarketPageContent,
  | 'aboutLabel'
  | 'closeLabel'
  | 'brandLabel'
  | 'deliveryTimeLabel'
  | 'minBasketLabel'
  | 'deliveryFeeLabel'
  | 'freeDeliveryThresholdLabel'
>;

interface MarketAboutDialogProps {
  readonly market: Market;
  readonly texts: MarketAboutTexts;
  readonly onClose: () => void;
}

/**
 * "Hakkında" penceresi (T16.2): magazanin bilinen bilgileri (marka, teslimat
 * suresi, minimum sepet, teslimat ucreti ve ucretsiz teslimat esigi). Kurallar
 * sunucudan gelir (ADR-15); burada hesap yok. Ortak pencere kabugu: odak
 * pencerede, Esc kapatir. Durumsuz.
 */
export function MarketAboutDialog({ market, texts, onClose }: MarketAboutDialogProps) {
  const { pricingRules } = market;
  const facts = [
    [texts.brandLabel, market.brand],
    [texts.deliveryTimeLabel, formatDeliveryTime(market.deliveryTime)],
    [texts.minBasketLabel, formatMoney(pricingRules.minBasket)],
    [texts.deliveryFeeLabel, formatMoney(pricingRules.deliveryFee)],
    [texts.freeDeliveryThresholdLabel, formatMoney(pricingRules.freeDeliveryThreshold)],
  ] as const;

  return (
    <Dialog title={texts.aboutLabel} close={{ label: texts.closeLabel, onAction: onClose }}>
      <div className={styles['c-market-about']}>
        <p className={styles['c-market-about__name']}>{market.name}</p>
        <dl className={styles['c-market-about__facts']}>
          {facts.map(([label, value]) => (
            <div key={label} className={styles['c-market-about__fact']}>
              <dt>{label}</dt>
              <dd className={styles['c-market-about__value']}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Dialog>
  );
}

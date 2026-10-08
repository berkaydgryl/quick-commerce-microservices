import type { Order, OrdersContent } from '@getir/contracts';

import { formatMoney } from '../../../shared/services/format';

import { OrderCard } from './OrderCard';
import styles from './OrderTotals.module.css';

/**
 * Siparisin tutar dokumu (T11.16; F17'de detay ve onay ekrani ortak): ara
 * toplam, teslimat ucreti (sifirsa "Ücretsiz"), varsa indirim, toplam.
 */
export function OrderTotals({
  texts,
  order,
}: {
  readonly texts: OrdersContent;
  readonly order: Order;
}) {
  return (
    <OrderCard as="dl">
      <div className={styles['c-order-totals__row']}>
        <dt>{texts.subtotalLabel}</dt>
        <dd>{formatMoney(order.subtotal)}</dd>
      </div>
      <div className={styles['c-order-totals__row']}>
        <dt>{texts.deliveryFeeLabel}</dt>
        <dd>
          {order.deliveryFee.amountMinor === 0
            ? texts.freeDeliveryLabel
            : formatMoney(order.deliveryFee)}
        </dd>
      </div>
      {order.discount.amountMinor > 0 && (
        <div className={styles['c-order-totals__row']}>
          <dt>{texts.discountLabel}</dt>
          <dd>−{formatMoney(order.discount)}</dd>
        </div>
      )}
      <div className={`${styles['c-order-totals__row']} ${styles['c-order-totals__row--total']}`}>
        <dt>{texts.totalLabel}</dt>
        <dd>{formatMoney(order.total)}</dd>
      </div>
    </OrderCard>
  );
}

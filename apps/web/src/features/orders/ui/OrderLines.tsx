import type { Order, OrdersContent } from '@getir/contracts';

import { formatMoney } from '../../../shared/services/format';
import { statusGroup } from '../services/order-status';

import { OrderCard } from './OrderCard';
import styles from './OrderLines.module.css';

interface OrderLinesProps {
  readonly texts: OrdersContent;
  readonly order: Order;
  /** Kartin basliginin kimligi (bolum bununla adlanir). */
  readonly headingId: string;
}

/**
 * Siparisin urunleri (T11.16; F17'de detay ve onay ekrani ortak): adet, ad,
 * satir tutari. Iptal edilen sipariste her urunde "Teslim edilmedi" (siparis
 * duzeyi, #91: kalem duzeyinde teslim bilgisi yok).
 */
export function OrderLines({ texts, order, headingId }: OrderLinesProps) {
  const undelivered = statusGroup(order.status) === 'cancelled';
  return (
    <OrderCard labelledBy={headingId}>
      <h2 id={headingId} className={styles['c-order-lines__title']}>
        {texts.itemsTitle}
      </h2>
      <ul className={styles['c-order-lines__list']} role="list">
        {order.lines.map((line) => (
          <li key={line.productId} className={styles['c-order-lines__line']}>
            <span className={styles['c-order-lines__quantity']}>{line.quantity}×</span>
            <span className={styles['c-order-lines__name']}>
              {line.name}
              {undelivered && (
                <span className={styles['c-order-lines__undelivered']}>
                  {texts.notDeliveredLabel}
                </span>
              )}
            </span>
            <span className={styles['c-order-lines__amount']}>{formatMoney(line.lineTotal)}</span>
          </li>
        ))}
      </ul>
    </OrderCard>
  );
}

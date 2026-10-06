import type { OrderStatus, OrdersContent } from '@getir/contracts';

import { statusGroup, statusLabel } from '../services/order-status';
import type { OrderStatusGroup } from '../services/order-status';

import styles from './OrderStatusLabel.module.css';

const GROUP_CLASS: Readonly<Record<OrderStatusGroup, string | undefined>> = {
  completed: styles['c-order-status--completed'],
  inProgress: styles['c-order-status--in-progress'],
  cancelled: styles['c-order-status--cancelled'],
};

interface OrderStatusLabelProps {
  readonly texts: OrdersContent;
  readonly status: OrderStatus;
  /** Ucret iade edildi: iptalin yanina " · Ücret iade edildi". */
  readonly refunded: boolean;
}

/**
 * Siparisin durumu (T11.16): Tamamlandı yesil yazi, Devam ediyor sari rozet,
 * İptal edildi gri yazi (iade edildiyse yaninda notu). Liste satiri ve detay
 * ayni etiketi kullanir.
 */
export function OrderStatusLabel({ texts, status, refunded }: OrderStatusLabelProps) {
  const group = statusGroup(status);
  return (
    <span className={`${styles['c-order-status']} ${GROUP_CLASS[group]}`}>
      {statusLabel(texts, group)}
      {group === 'cancelled' && refunded && ` · ${texts.refundedLabel}`}
    </span>
  );
}

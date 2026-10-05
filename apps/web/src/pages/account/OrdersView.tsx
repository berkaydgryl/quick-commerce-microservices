import type { OrdersContent, OrderSummary } from '@getir/contracts';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { ChevronRightIcon } from '../../features/address/ui/icons';
import { orderPath } from '../../features/orders/routes';
import { OrderStatusLabel } from '../../features/orders/ui/OrderStatusLabel';
import { formatDateTime, formatMoney } from '../../shared/services/format';
import { QueryError, QueryLoading } from '../../shared/ui/query-status/QueryStatus';

import styles from './OrdersView.module.css';

export interface OrdersViewProps {
  readonly texts: OrdersContent;
  /** Yuklenmis sayfalarin siparisleri, yeniden eskiye; ilk sayfa gelene kadar undefined. */
  readonly orders: readonly OrderSummary[] | undefined;
  /** Ilk sayfanin hatasi (liste yokken). */
  readonly error: Error | null;
  readonly onRetry: () => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /** Sonraki sayfanin hatasi: liste yerinde kalir, altinda tekrar dene. */
  readonly moreError: Error | null;
  readonly onMore: () => void;
}

/**
 * Gecmis Siparislerim (T11.16; gorsel dil Adreslerim'in beyaz karti): satir
 * "Market · 500,00 TL · Tamamlandı", altinda tarih, sagda ok; satirin tamami
 * detayin baglantisi. Altta "Daha fazla göster" (sonraki sayfa). Durumsuz.
 */
export function OrdersView({
  texts,
  orders,
  error,
  onRetry,
  hasMore,
  loadingMore,
  moreError,
  onMore,
}: OrdersViewProps) {
  const titleId = useId();

  return (
    <section
      className={styles['c-orders']}
      aria-labelledby={titleId}
      aria-busy={(orders === undefined && error === null) || loadingMore}
    >
      <h1 id={titleId} className={styles['c-orders__title']}>
        {texts.title}
      </h1>
      {orders === undefined && error === null && <QueryLoading>{texts.loadingLabel}</QueryLoading>}
      {orders === undefined && error !== null && <QueryError error={error} onRetry={onRetry} />}
      {orders !== undefined && (
        <div className={styles['c-orders__card']}>
          {orders.length === 0 ? (
            <p className={styles['c-orders__empty']}>{texts.emptyNotice}</p>
          ) : (
            <ul className={styles['c-orders__list']} role="list">
              {orders.map((order) => (
                <li key={order.id} className={styles['c-orders__row']}>
                  <Link to={orderPath(order.id)} className={styles['c-orders__link']}>
                    <span className={styles['c-orders__text']}>
                      <span className={styles['c-orders__summary']}>
                        <span className={styles['c-orders__market']}>
                          {order.marketName ?? texts.unknownMarketLabel}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatMoney(order.total)}</span>
                        <span aria-hidden="true">·</span>
                        <OrderStatusLabel
                          texts={texts}
                          status={order.status}
                          refunded={order.refunded === true}
                        />
                      </span>
                      <time className={styles['c-orders__date']} dateTime={order.createdAt}>
                        {formatDateTime(order.createdAt)}
                      </time>
                    </span>
                    <span className={styles['c-orders__arrow']} aria-hidden="true">
                      <ChevronRightIcon />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {moreError !== null && <QueryError error={moreError} onRetry={onMore} />}
          {hasMore && moreError === null && (
            <button
              type="button"
              className={styles['c-orders__more']}
              disabled={loadingMore}
              onClick={onMore}
            >
              {loadingMore ? texts.loadingMoreLabel : texts.moreLabel}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

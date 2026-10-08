import type { Order, OrdersContent } from '@getir/contracts';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { wasRefunded } from '../../features/orders/services/order-status';
import { paymentLabel } from '../../features/orders/services/payment-label';
import { OrderCard } from '../../features/orders/ui/OrderCard';
import { OrderLines } from '../../features/orders/ui/OrderLines';
import { OrderStatusLabel } from '../../features/orders/ui/OrderStatusLabel';
import { OrderTotals } from '../../features/orders/ui/OrderTotals';
import { OrderTrack } from '../../features/orders/ui/OrderTrack';
import { ChevronLeftIcon } from '../../features/profile/ui/icons';
import { formatDateTime } from '../../shared/services/format';
import { QueryError, QueryLoading } from '../../shared/ui/query-status/QueryStatus';

import styles from './OrderDetailView.module.css';

export interface OrderDetailViewProps {
  readonly texts: OrdersContent;
  /** Siparis; gelene kadar undefined. */
  readonly order: Order | undefined;
  /** Market adi (katalog); market bulunamazsa genel ad, yuklenirken undefined. */
  readonly marketName: string | undefined;
  readonly error: Error | null;
  readonly onRetry: () => void;
  /** Gecmis Siparislerim listesine donus. */
  readonly listHref: string;
  /** "Kuryem nerede" penceresini acar (F22); yalniz "Kurye yolda"da basilir. */
  readonly onWhereIsCourier?: () => void;
  /** "Kuryem nerede" dugmesinin kimligi (pencere kapaninca odak). */
  readonly courierButtonId?: string;
  /** Takip kartinin basliginin kimligi (dugme yoksa odagin yedegi). */
  readonly trackHeadingId?: string;
}

/**
 * Siparis detayi (T11.16; /hesabim/siparislerim/:id): ustte listeye donus,
 * market adi ve durum; tarih, teslimat adresi ve odeme (F12: kart ya da
 * kapida nakit/kart; eski sipariste yok); urunler (adet, ad, tutar);
 * tutar dokumu; en altta takip cizgisi (F21; suren ve teslim edilen
 * sipariste; 07.10 kullanici: toplamin altinda). Iptal edilen sipariste her urunde "Teslim edilmedi" (siparis
 * duzeyi, #91: kalem duzeyinde teslim bilgisi yok). Durumsuz.
 */
export function OrderDetailView({
  texts,
  order,
  marketName,
  error,
  onRetry,
  listHref,
  onWhereIsCourier,
  courierButtonId,
  trackHeadingId,
}: OrderDetailViewProps) {
  const titleId = useId();
  const itemsId = useId();
  const payment = paymentLabel(order?.payment, texts);

  return (
    <section
      className={styles['c-order-detail']}
      aria-labelledby={titleId}
      aria-busy={order === undefined && error === null}
    >
      <Link to={listHref} className={styles['c-order-detail__back']}>
        <span className={styles['c-order-detail__back-icon']}>
          <ChevronLeftIcon />
        </span>
        {texts.title}
      </Link>
      {order === undefined && error === null && <QueryLoading>{texts.loadingLabel}</QueryLoading>}
      {order === undefined && error !== null && <QueryError error={error} onRetry={onRetry} />}
      {order !== undefined && (
        <>
          <header className={styles['c-order-detail__head']}>
            <h1 id={titleId} className={styles['c-order-detail__title']}>
              {marketName ?? texts.unknownMarketLabel}
            </h1>
            <OrderStatusLabel texts={texts} status={order.status} refunded={wasRefunded(order)} />
          </header>
          <OrderCard as="dl">
            <div className={styles['c-order-detail__fact']}>
              <dt>{texts.dateLabel}</dt>
              <dd>
                <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time>
              </dd>
            </div>
            <div className={styles['c-order-detail__fact']}>
              <dt>{texts.addressLabel}</dt>
              <dd>{order.address.line}</dd>
            </div>
            {payment !== undefined && (
              <div className={styles['c-order-detail__fact']}>
                <dt>{texts.paymentLabel}</dt>
                <dd>{payment}</dd>
              </div>
            )}
          </OrderCard>
          <OrderLines texts={texts} order={order} headingId={itemsId} />
          <OrderTotals texts={texts} order={order} />
          <OrderTrack
            status={order.status}
            texts={texts}
            {...(onWhereIsCourier === undefined ? {} : { onWhereIsCourier })}
            {...(courierButtonId === undefined ? {} : { courierButtonId })}
            {...(trackHeadingId === undefined ? {} : { headingId: trackHeadingId })}
          />
        </>
      )}
    </section>
  );
}

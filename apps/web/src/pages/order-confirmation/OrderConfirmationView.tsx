import type { Order, OrderConfirmationContent, OrdersContent } from '@getir/contracts';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { wasRefunded } from '../../features/orders/services/order-status';
import {
  confirmationKind,
  deliveryDetailRows,
} from '../../features/orders/services/order-confirmation';
import type {
  ConfirmationHeading,
  DeliveryDetailTexts,
  DetailRow,
} from '../../features/orders/services/order-confirmation';
import { OrderCard } from '../../features/orders/ui/OrderCard';
import { OrderLines } from '../../features/orders/ui/OrderLines';
import { OrderStatusLabel } from '../../features/orders/ui/OrderStatusLabel';
import { OrderTotals } from '../../features/orders/ui/OrderTotals';
import { OrderTrack } from '../../features/orders/ui/OrderTrack';
import { formatDateTime } from '../../shared/services/format';
import { QueryError, QueryLoading } from '../../shared/ui/query-status/QueryStatus';

import { ConfirmationMark } from './ConfirmationMark';
import styles from './OrderConfirmationView.module.css';

export interface OrderConfirmationViewProps {
  readonly texts: OrderConfirmationContent;
  /**
   * Baslik: akistan gelen sonuc ya da okunan durum; bilinene kadar undefined.
   * Siparis okunamasa da (hata) baslik gorunur: odeme alindi.
   */
  readonly heading: ConfirmationHeading | undefined;
  readonly orderTexts: OrdersContent;
  /** Teslimat ayrintilarinin etiketleri (odeme sayfasinin metinleri) ve "Zili Çalma". */
  readonly detailTexts: DeliveryDetailTexts & { readonly doNotRingLabel: string };
  /** Siparis; gelene kadar undefined. */
  readonly order: Order | undefined;
  readonly error: Error | null;
  readonly onRetry: () => void;
  /** Market adi (katalog); bulunamazsa genel ad, yuklenirken undefined. */
  readonly marketName: string | undefined;
  /** "Tahmini varış süresi" ve "20-30 dk"; yalniz siparis yoldayken. */
  readonly estimate?: DetailRow | undefined;
  /** Odeme satiri ("Visa •••• 4242", "Kart", "Kapıda nakit"); eski sipariste yok. */
  readonly payment: string | undefined;
  readonly ordersHref: string;
  readonly continueHref: string;
  /** "Kuryem nerede" (F22); yalniz "Kurye yolda"da basilir. */
  readonly onWhereIsCourier?: () => void;
  readonly courierButtonId?: string;
  readonly trackHeadingId?: string;
}

/**
 * Siparis onay ekrani (F17; /siparis/:id/onay): ortada isaret ve baslik
 * ("Siparişin alındı!"; incelemede "Siparişin inceleniyor" ve not), hemen
 * altinda takip cizgisi (F21), ozet (market, tarih, tahmini varis, adres,
 * odeme), varsa teslimat ayrintilari, urunler, tutarlar ve iki dugme. Siparis
 * sonradan onay olmayan duruma gecerse baslik kalir, durum etiketi gercegi
 * soyler. Durumsuz.
 */
export function OrderConfirmationView(props: OrderConfirmationViewProps) {
  const { texts, orderTexts, order, error } = props;
  const titleId = useId();
  return (
    <section
      className={styles['c-order-confirmation']}
      aria-labelledby={titleId}
      aria-busy={order === undefined && error === null}
    >
      {props.heading !== undefined && (
        <ConfirmationHead
          texts={texts}
          orderTexts={orderTexts}
          heading={props.heading}
          order={order}
          titleId={titleId}
        />
      )}
      {order === undefined && error === null && (
        <QueryLoading>{orderTexts.loadingLabel}</QueryLoading>
      )}
      {order === undefined && error !== null && (
        <QueryError error={error} onRetry={props.onRetry} />
      )}
      {order !== undefined && (
        <>
          <OrderTrack
            status={order.status}
            texts={orderTexts}
            {...(props.onWhereIsCourier === undefined
              ? {}
              : { onWhereIsCourier: props.onWhereIsCourier })}
            {...(props.courierButtonId === undefined
              ? {}
              : { courierButtonId: props.courierButtonId })}
            {...(props.trackHeadingId === undefined ? {} : { headingId: props.trackHeadingId })}
          />
          <ConfirmationSummary {...props} order={order} />
          <ConfirmationDetails {...props} order={order} />
          <OrderLines texts={orderTexts} order={order} headingId={`${titleId}-items`} />
          <OrderTotals texts={orderTexts} order={order} />
          <div className={styles['c-order-confirmation__actions']}>
            <Link
              to={props.ordersHref}
              className={`${styles['c-order-confirmation__action']} ${styles['c-order-confirmation__action--primary']}`}
            >
              {texts.ordersLinkLabel}
            </Link>
            <Link to={props.continueHref} className={styles['c-order-confirmation__action']}>
              {texts.continueLabel}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

function ConfirmationHead({
  texts,
  orderTexts,
  heading,
  order,
  titleId,
}: {
  readonly texts: OrderConfirmationContent;
  readonly orderTexts: OrdersContent;
  readonly heading: ConfirmationHeading;
  readonly order: Order | undefined;
  readonly titleId: string;
}) {
  const review = heading === 'review';
  // Onay olmayan duruma gecen sipariste (ret, iptal, odeme bekliyor) gercek durum.
  const moved = order !== undefined && confirmationKind(order.status) === 'other';
  return (
    <header className={styles['c-order-confirmation__head']}>
      <ConfirmationMark review={review} />
      <h1 id={titleId} className={styles['c-order-confirmation__title']}>
        {review ? texts.reviewTitle : texts.placedTitle}
      </h1>
      {review && !moved && (
        <p className={styles['c-order-confirmation__notice']}>{texts.reviewNotice}</p>
      )}
      {moved && (
        <OrderStatusLabel texts={orderTexts} status={order.status} refunded={wasRefunded(order)} />
      )}
    </header>
  );
}

function Facts({ rows }: { readonly rows: readonly DetailRow[] }) {
  return (
    <dl className={styles['c-order-confirmation__facts']}>
      {rows.map((row) => (
        <div key={row.label} className={styles['c-order-confirmation__fact']}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ConfirmationSummary(props: OrderConfirmationViewProps & { readonly order: Order }) {
  const { texts, orderTexts, order } = props;
  const headingId = useId();
  const rows: DetailRow[] = [
    ...(props.estimate === undefined ? [] : [props.estimate]),
    { label: orderTexts.addressLabel, value: order.address.line },
    ...(props.payment === undefined
      ? []
      : [{ label: orderTexts.paymentLabel, value: props.payment }]),
  ];
  return (
    <OrderCard labelledBy={headingId}>
      <h2 id={headingId} className={styles['c-order-confirmation__subtitle']}>
        {texts.summaryTitle}
      </h2>
      <div className={styles['c-order-confirmation__market']}>
        {/* Yuklenirken bos: once genel ad ("Market") gorunup sonra degismesin. */}
        <p className={styles['c-order-confirmation__market-name']}>{props.marketName}</p>
        <time dateTime={order.createdAt} className={styles['c-order-confirmation__date']}>
          {formatDateTime(order.createdAt)}
        </time>
      </div>
      <Facts rows={rows} />
    </OrderCard>
  );
}

function ConfirmationDetails(props: OrderConfirmationViewProps & { readonly order: Order }) {
  const { texts, detailTexts, order } = props;
  const headingId = useId();
  const rows = deliveryDetailRows(order.details, detailTexts);
  const doNotRing = order.details?.doNotRingBell === true;
  if (rows.length === 0 && !doNotRing) {
    return null;
  }
  return (
    <OrderCard labelledBy={headingId}>
      <h2 id={headingId} className={styles['c-order-confirmation__subtitle']}>
        {texts.detailsTitle}
      </h2>
      {rows.length > 0 && <Facts rows={rows} />}
      {doNotRing && (
        <p className={styles['c-order-confirmation__bell']}>{detailTexts.doNotRingLabel}</p>
      )}
    </OrderCard>
  );
}

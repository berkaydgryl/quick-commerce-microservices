import type { CheckoutContent } from '@getir/contracts';

import { useCountdown } from '../hooks/useCountdown';
import { formatCountdown, isReservationWarning } from '../services/countdown';
import { heldExpiresAt } from '../services/held-order';
import type { ReservationPhase } from '../services/reservation-plan';
import { userMessage } from '../services/user-message';

import styles from './ReservationStatus.module.css';

export type ReservationTexts = Pick<
  CheckoutContent,
  | 'reservationHeldPrefix'
  | 'reservationHeldSuffix'
  | 'reservationPendingLabel'
  | 'reservationLastMinuteNotice'
  | 'reservationRetryLabel'
  | 'paymentStatusUnavailableNotice'
>;

interface ReservationStatusProps {
  readonly phase: ReservationPhase;
  readonly texts: ReservationTexts;
  readonly onRetry: () => void;
  /**
   * Yenilemede bekleyen 3DS'in durumu okunamadi (F15b): verilirse "Ödeme durumu
   * alınamadı." ve bu "Tekrar dene"; siparis birakilmaz.
   */
  readonly onPaymentStatusRetry?: (() => void) | undefined;
}

/**
 * Odeme ozetindeki rezervasyon satiri (T12.4; erken rezervasyon, kullanici
 * istegi): "Ürünlerin 9:41 boyunca senin için ayrıldı." Sure sunucunun
 * ttlSeconds'indan, odeme sayfasinin tek monotonik saatiyle (3DS'le ayni);
 * son 60 saniyede uyari rengi ve ekran okuyucuya BIR kez "Son 1 dakika".
 * Istek surerken "Ürünlerin ayrılıyor…"; hatada sunucunun cumlesi ve "Tekrar
 * dene" (canli bolge). Yenilemede bekleyen 3DS okunamadiysa (F15b) "Ödeme
 * durumu alınamadı." ve "Tekrar dene". Siparis verildiyse ya da kosul yoksa satir yok.
 */
export function ReservationStatus({
  phase,
  texts,
  onRetry,
  onPaymentStatusRetry,
}: ReservationStatusProps) {
  const remaining = useCountdown(phase.kind === 'held' ? heldExpiresAt(phase.held) : undefined);

  if (onPaymentStatusRetry !== undefined) {
    return (
      <div
        className={`${styles['c-reservation-status']} ${styles['c-reservation-status--failed']}`}
        role="status"
      >
        <p>{texts.paymentStatusUnavailableNotice}</p>
        <button
          type="button"
          className={styles['c-reservation-status__retry']}
          onClick={onPaymentStatusRetry}
        >
          {texts.reservationRetryLabel}
        </button>
      </div>
    );
  }

  if (phase.kind === 'reserving') {
    return (
      <p className={styles['c-reservation-status']} role="status">
        {texts.reservationPendingLabel}
      </p>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <div
        className={`${styles['c-reservation-status']} ${styles['c-reservation-status--failed']}`}
        role="status"
      >
        <p>{userMessage(phase.error)}</p>
        <button type="button" className={styles['c-reservation-status__retry']} onClick={onRetry}>
          {texts.reservationRetryLabel}
        </button>
      </div>
    );
  }
  if (phase.kind !== 'held' || remaining === undefined) {
    return null;
  }
  const warning = isReservationWarning(remaining);
  return (
    <p className={styles['c-reservation-status']}>
      {texts.reservationHeldPrefix}{' '}
      <span
        role="timer"
        className={
          warning
            ? `${styles['c-reservation-status__time']} ${styles['is-warning']}`
            : styles['c-reservation-status__time']
        }
      >
        {formatCountdown(remaining)}
      </span>{' '}
      {texts.reservationHeldSuffix}
      <span className={styles['c-reservation-status__sr']} aria-live="polite">
        {warning ? texts.reservationLastMinuteNotice : ''}
      </span>
    </p>
  );
}

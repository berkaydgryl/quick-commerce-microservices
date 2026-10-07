import type { CheckoutContent } from '@getir/contracts';
import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

import { useCountdown } from '../hooks/useCountdown';
import { formatCountdown, isReservationWarning } from '../services/countdown';
import { heldExpiresAt } from '../services/held-order';
import type { ReservationPhase } from '../services/reservation-plan';

import styles from './ReservationStatus.module.css';

export type ReservationTexts = Pick<
  CheckoutContent,
  | 'reservationHeldPrefix'
  | 'reservationHeldSuffix'
  | 'reservationPendingLabel'
  | 'reservationLastMinuteNotice'
  | 'reservationRetryLabel'
>;

interface ReservationStatusProps {
  readonly phase: ReservationPhase;
  readonly texts: ReservationTexts;
  readonly onRetry: () => void;
}

const failureMessage = (error: unknown): string =>
  error instanceof AppError ? error.message : errorMessage(ERROR_CODES.INTERNAL);

/**
 * Odeme ozetindeki rezervasyon satiri (T12.4; erken rezervasyon, kullanici
 * istegi): "Ürünlerin 9:41 boyunca senin için ayrıldı." Sure sunucunun
 * ttlSeconds'indan, odeme sayfasinin tek monotonik saatiyle (3DS'le ayni);
 * son 60 saniyede uyari rengi ve ekran okuyucuya BIR kez "Son 1 dakika".
 * Istek surerken "Ürünlerin ayrılıyor…"; hatada sunucunun cumlesi ve "Tekrar
 * dene" (canli bolge). Siparis verildiyse ya da kosul yoksa satir yok.
 */
export function ReservationStatus({ phase, texts, onRetry }: ReservationStatusProps) {
  const remaining = useCountdown(phase.kind === 'held' ? heldExpiresAt(phase.held) : undefined);

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
        <p>{failureMessage(phase.error)}</p>
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

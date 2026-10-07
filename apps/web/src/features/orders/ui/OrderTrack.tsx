import type { OrderStatus, OrdersContent } from '@getir/contracts';
import { useId } from 'react';

import { CheckIcon } from '../../address/ui/icons';
import { TRACK_STEPS, trackStep, trackStepState } from '../services/order-track';
import type { TrackStep } from '../services/order-track';

import styles from './OrderTrack.module.css';

export type OrderTrackTexts = Pick<
  OrdersContent,
  | 'trackTitle'
  | 'trackPreparingLabel'
  | 'trackOnTheWayLabel'
  | 'trackDeliveredLabel'
  | 'whereIsCourierLabel'
  | 'whereIsCourierHint'
>;

interface OrderTrackProps {
  readonly status: OrderStatus;
  readonly texts: OrderTrackTexts;
  /** "Kuryem nerede" penceresini acar (F22); verilmezse dugme pasif kalir. */
  readonly onWhereIsCourier?: () => void;
}

const LABEL_KEY: Readonly<Record<TrackStep, keyof OrderTrackTexts>> = {
  preparing: 'trackPreparingLabel',
  onTheWay: 'trackOnTheWayLabel',
  delivered: 'trackDeliveredLabel',
};

/** Rayin mor bolumu: hazirlaniyorda yok, yoldayken yarisi, teslimde tamami. */
const PROGRESS_CLASS: Readonly<Record<TrackStep, string | undefined>> = {
  preparing: styles['c-order-track__steps--preparing'],
  onTheWay: styles['c-order-track__steps--on-the-way'],
  delivered: styles['c-order-track__steps--delivered'],
};

/**
 * Siparis takip cizgisi (F21; siparis detayinin en alti, F17 onay ekrani):
 * kartta "Sipariş durumu" basligi ve uc adim (sirali liste; aktif adimda
 * aria-current="step"). Yuvarlaklar tek ve kesintisiz bir rayin ustunde;
 * gecilen adim dolu mor ve tikli, aktif adim dolu mor ve yumusak hareli
 * (hareket azaltmada sabit), gelecek adim beyaz; teslim edildiyse uc adim da
 * tikli ve sabit. Listenin altinda ortali "Kuryem nerede": yalniz "Kurye
 * yolda" aktifken ve pencere verildiyse basilir; hazirlanirken pasif ve
 * altinda bilgi satiri (dugmeye aria-describedby ile bagli), teslimde yok
 * (kurye isi bitti; PM 07.10). Cizgi disi durumda (odeme
 * oncesi, inceleme, iptal) hicbir sey cizilmez. Durumsuz.
 */
export function OrderTrack({ status, texts, onWhereIsCourier }: OrderTrackProps) {
  const titleId = useId();
  const hintId = useId();
  const current = trackStep(status);
  if (current === null) {
    return null;
  }

  return (
    <section className={styles['c-order-track']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['c-order-track__title']}>
        {texts.trackTitle}
      </h2>
      <ol className={`${styles['c-order-track__steps']} ${PROGRESS_CLASS[current]}`} role="list">
        {TRACK_STEPS.map((step) => {
          const state = trackStepState(step, current);
          return (
            <li
              key={step}
              className={`${styles['c-order-track__step']} ${styles[`is-${state}`]}`}
              aria-current={step === current ? 'step' : undefined}
            >
              <span className={styles['c-order-track__dot']} aria-hidden="true">
                {state === 'done' && <CheckIcon />}
              </span>
              <span className={styles['c-order-track__label']}>{texts[LABEL_KEY[step]]}</span>
            </li>
          );
        })}
      </ol>
      {current !== 'delivered' && (
        <div className={styles['c-order-track__actions']}>
          <button
            type="button"
            className={styles['c-order-track__courier']}
            disabled={current !== 'onTheWay' || onWhereIsCourier === undefined}
            aria-describedby={current === 'preparing' ? hintId : undefined}
            onClick={onWhereIsCourier}
          >
            {texts.whereIsCourierLabel}
          </button>
          {current === 'preparing' && (
            <p id={hintId} className={styles['c-order-track__hint']}>
              {texts.whereIsCourierHint}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

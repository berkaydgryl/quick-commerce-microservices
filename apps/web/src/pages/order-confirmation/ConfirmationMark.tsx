import { STROKE_PROPS } from '../../shared/ui/icons/stroke-props';

import styles from './ConfirmationMark.module.css';

/**
 * Onay ekraninin isareti (F17; kullanici: "ortada mor onay isareti"): mor
 * dairede beyaz onay; risk incelemesinde acik mor dairede saat. Ekranin tek
 * hareketi: daire bir kez buyur, onay cizilir (hareket azaltmada sabit).
 * Susleme: anlam basliktadir (aria-hidden).
 */
export function ConfirmationMark({ review }: { readonly review: boolean }) {
  return (
    <span
      className={`${styles['c-confirmation-mark']} ${review ? styles['c-confirmation-mark--review'] : ''}`}
      aria-hidden="true"
    >
      {review ? (
        <svg {...STROKE_PROPS} className={styles['c-confirmation-mark__icon']}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2" />
        </svg>
      ) : (
        <svg {...STROKE_PROPS} strokeWidth={2.5} className={styles['c-confirmation-mark__icon']}>
          <path
            className={styles['c-confirmation-mark__check']}
            pathLength={1}
            d="M6 12.5l4 4 8-9"
          />
        </svg>
      )}
    </span>
  );
}

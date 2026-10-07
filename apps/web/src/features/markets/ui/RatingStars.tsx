import { ratingStars } from '../services/rating-stars';

import { StarIcon } from './icons';
import styles from './RatingStars.module.css';

const FILL_CLASS = {
  full: styles['c-rating-stars__fill--full'],
  half: styles['c-rating-stars__fill--half'],
  empty: styles['c-rating-stars__fill--empty'],
} as const;

/**
 * Puanin yildizlari (T16.2; referans getircarsi): gri yildizlarin ustunde
 * sari dolgu; yarim yildizda dolgunun sol yarisi. Yalnizca gorsel: puanin
 * kendisi yanindaki metindedir, ekran okuyucu yildizlari okumaz.
 */
export function RatingStars({ average }: { readonly average: number }) {
  return (
    <span className={styles['c-rating-stars']} aria-hidden="true">
      {ratingStars(average).map((fill, index) => (
        <span key={index} className={styles['c-rating-stars__star']}>
          <StarIcon />
          <span className={`${styles['c-rating-stars__fill']} ${FILL_CLASS[fill]}`}>
            <StarIcon />
          </span>
        </span>
      ))}
    </span>
  );
}

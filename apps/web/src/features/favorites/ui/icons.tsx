/** Favori ikonu (T11.13); ortak ayarlar shared/ui/icons. */

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

/** Kalp: cizgi her zaman; dolgu cevreden (favoriyken marka moru). */
export function HeartIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M12 20s-7-4.4-9.2-8.6C1.4 8.6 3 5 6.5 5c2.1 0 3.4 1.2 5.5 3.3C14.1 6.2 15.4 5 17.5 5 21 5 22.6 8.6 21.2 11.4 19 15.6 12 20 12 20z" />
    </svg>
  );
}

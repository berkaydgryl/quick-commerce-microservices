/** Market listesinin ikonlari (T11.12); ortak ayarlar shared/ui/icons. */

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

export function ChevronDownIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Puanin yildizi: dolu (cizgi ikonun dolgusu currentColor). */
export function StarIcon() {
  return (
    <svg {...STROKE_PROPS} fill="currentColor">
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </svg>
  );
}

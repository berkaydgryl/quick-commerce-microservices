/** Sepetin ikonlari (T11.12); ortak ayarlar shared/ui/icons. */

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

/** Bos sepetin cantasi (referans getircarsi "Sepetin şu an boş"). */
export function BagIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M6 7h12l1 13H5z" />
      <path d="M9 10V6a3 3 0 0 1 6 0v4" />
    </svg>
  );
}

/** Magaza (sepet panelinin ust satiri; referans getircarsi): tente ve vitrin. */
export function StoreIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M4 9h16l-1-4H5z" />
      <path d="M4 9v1a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0V9" />
      <path d="M5 12.5V20h14v-7.5" />
      <path d="M9.5 20v-4.5h5V20" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

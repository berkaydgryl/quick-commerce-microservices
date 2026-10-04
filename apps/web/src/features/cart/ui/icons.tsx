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

export function ChevronRightIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

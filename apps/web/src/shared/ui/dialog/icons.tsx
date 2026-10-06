/** Pencere kabugunun ikonlari (T11.8'de adres penceresi icin; T11.17'de ortaklasti): geri oku ve X. */

import { STROKE_PROPS } from '../icons/stroke-props';

export function BackIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

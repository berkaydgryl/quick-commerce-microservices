/** Adres secicinin ikonlari (T9.5); ortak ayarlar shared/ui/icons. */

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

export function PinIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

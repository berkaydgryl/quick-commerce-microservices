/** Ust bar aramasinin ikonlari (T11.10); ortak ayarlar shared/ui/icons. */

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

export function SearchIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

export function ClearIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

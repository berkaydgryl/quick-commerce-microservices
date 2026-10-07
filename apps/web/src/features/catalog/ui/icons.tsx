/** Katalog ekranlarinin ikonlari (T9.5); ortak ayarlar shared/ui/icons. */

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

/** "Tümü" (magaza sayfasinin kategori listesi, T16.2): dort kare. */
export function GridIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

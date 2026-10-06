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

export function ChevronRightIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M9 6l6 6-6 6" />
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

export function SearchIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

/** Haritanin ortasindaki pin (T11.8): dolu damla + ev; renkler CSS'ten (currentColor). */
export function HomePinIcon() {
  return (
    <svg viewBox="0 0 40 48" aria-hidden focusable={false}>
      <path d="M20 47s17-15.6 17-28A17 17 0 0 0 3 19c0 12.4 17 28 17 28z" fill="currentColor" />
      <path
        d="M12 20.5 20 13l8 7.5V28a1 1 0 0 1-1 1h-4.5v-5h-5v5H13a1 1 0 0 1-1-1z"
        fill="none"
        style={{ stroke: 'var(--text-on-brand)' }}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Adreslerim'in cop kutusu (T11.15): secili olmayan adresi silme. */
export function TrashIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/** Adreslerim'in ekleme satiri (T11.15): "Ev adresi ekle". */
export function PlusIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

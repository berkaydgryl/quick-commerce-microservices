/**
 * Profil kartinin ikonlari (T11.14; PR 2'de referansa gore yenilendi:
 * getircarsi profil karti): duzenleme (kare ustunde kalem), e-posta ve
 * telefon (iki renkli dolgu), dogrulama onayi ve geri oku.
 *
 * Iki renkli ikonlarin ana rengi cevreden gelir (currentColor), ikinci rengi
 * `--icon-accent` degiskeninden; ikisini de kullanan bilesenin CSS'i verir.
 * Ikonlar suslemedir (aria-hidden); anlam yanlarindaki metinde ya da
 * kapsayicinin erisilebilir adindadir.
 */

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

/** Dolgu ikonlarinin ortak ayarlari (cizgi ikonlarinin STROKE_PROPS'u gibi). */
const FILL_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
} as const;

/** Ikinci renk ve ikonun zemin rengindeki ic cizgiler. */
const ACCENT = { fill: 'var(--icon-accent, currentColor)' } as const;
const SURFACE = { fill: 'var(--bg-surface)' } as const;

export function EditIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
      <path d="M17.6 3.6a2 2 0 0 1 2.8 2.8L12 14.8 8.5 15.5l.7-3.5z" />
    </svg>
  );
}

/** Acik zarf: mor mektup (iki satir), sari zarf govdesi. */
export function MailIcon() {
  return (
    <svg {...FILL_PROPS}>
      <rect x="6" y="2" width="12" height="11" rx="2" />
      <rect x="9" y="5" width="6" height="1.6" rx="0.8" style={SURFACE} />
      <rect x="9" y="8" width="6" height="1.6" rx="0.8" style={SURFACE} />
      <path d="M2 10.5l10 6 10-6V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" style={ACCENT} />
    </svg>
  );
}

/** Telefon: sari govde, mor ekran. */
export function PhoneIcon() {
  return (
    <svg {...FILL_PROPS}>
      <rect x="5.5" y="1.5" width="13" height="21" rx="2.5" style={ACCENT} />
      <rect x="5.5" y="4.5" width="13" height="15" />
    </svg>
  );
}

export function VerifiedIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

/** Telefonda alt sekmeden Hesabim'a donen baglantinin oku. */
export function ChevronLeftIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

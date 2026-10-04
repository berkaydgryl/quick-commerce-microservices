/**
 * Profil kartinin ikonlari (T11.14; referans getircarsi profil karti): kalem,
 * telefon, zarf ve dogrulama onayi. Ortak SVG ayarlari shared'da.
 */

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

export function PencilIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function MailIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
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

import { STROKE_PROPS } from '../../../shared/ui/icons/stroke-props';

import styles from './SecurityNotice.module.css';

interface SecurityNoticeProps {
  readonly title: string;
  readonly text: string;
}

/** Kasa ikonu: kapak, kadran ve kol (suslemedir). */
function VaultIcon() {
  return (
    <svg {...STROKE_PROPS}>
      <rect x="3" y="4" width="18" height="15" rx="2" />
      <circle cx="11" cy="11.5" r="3.5" />
      <path d="M11 8v1.5M11 13.5V15M8 11.5h-1.5M15.5 11.5H14M18 9.5v4M6 19v1.5M16 19v1.5" />
    </svg>
  );
}

/**
 * Guvenlik kutusu (T11.17; referans getircarsi "Kart Ekle"): ikon, baslik ve
 * kendi metnimiz: tam numara ve CVV saklanmaz, yalnizca ilk 4 ve son 4 hane;
 * kart her an silinebilir. Masterpass yok (onu kullanmiyoruz).
 */
export function SecurityNotice({ title, text }: SecurityNoticeProps) {
  return (
    <section className={styles['c-security-notice']} aria-label={title}>
      <span className={styles['c-security-notice__icon']} aria-hidden="true">
        <VaultIcon />
      </span>
      <div className={styles['c-security-notice__text']}>
        <h2 className={styles['c-security-notice__title']}>{title}</h2>
        <p>{text}</p>
      </div>
    </section>
  );
}

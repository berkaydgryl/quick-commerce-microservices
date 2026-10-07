import type { ReactNode } from 'react';
import { useId } from 'react';

import styles from './SectionCard.module.css';

interface SectionCardProps {
  readonly title: string;
  /** Basligin sagindaki eylem (anahtar, "Değiştir"). */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Basligi ustte, icerigi beyaz kartta bir bolum (T17.1; referans getircarsi
 * odeme sayfasi: Hediye Bilgileri, Teslimat Yöntemi, Not Ekle, Ödeme Yöntemi).
 * Bolum basligiyla adlanir (aria-labelledby).
 */
export function SectionCard({ title, action, children }: SectionCardProps) {
  const titleId = useId();
  return (
    <section className={styles['c-section-card']} aria-labelledby={titleId}>
      <div className={styles['c-section-card__head']}>
        <h2 id={titleId} className={styles['c-section-card__title']}>
          {title}
        </h2>
        {action}
      </div>
      <div className={styles['c-section-card__card']}>{children}</div>
    </section>
  );
}

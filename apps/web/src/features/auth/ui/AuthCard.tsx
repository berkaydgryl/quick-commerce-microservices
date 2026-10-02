import { useId } from 'react';
import type { ReactNode } from 'react';

import styles from './AuthCard.module.css';

interface AuthCardProps {
  /** Kartin basligi (icerikten). */
  readonly title: string;
  /**
   * Basligin duzeyi: giris ve kayit ekraninda sayfanin h1'idir; karsilama
   * ekraninda h1 banner oldugu icin h2.
   */
  readonly headingLevel: 1 | 2;
  readonly children: ReactNode;
}

/** Kimlik karti (T11.6): baslik + form; karsilama, giris ve kayit ekrani ayni karti kullanir. */
export function AuthCard({ title, headingLevel, children }: AuthCardProps) {
  const titleId = useId();
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section className={styles['c-auth-card']} aria-labelledby={titleId}>
      <Heading id={titleId} className={styles['c-auth-card__title']}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

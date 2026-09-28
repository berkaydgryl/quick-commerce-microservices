import type { ReactNode } from 'react';

import styles from './Badge.module.css';

/**
 * Rozet - TASARIMSIZ KABUK (D11): kisa durum etiketi ("Kapali").
 *
 * Market listesi ve market basligi ayni rozeti kullanir; once ikincisi
 * birincinin sinifini oduncluyordu. Bugunku gorunum listeden AYNEN tasindi;
 * gorsel tasarim T16.1'de (tasarim sistemi, "rozet") yalnizca burada yapilir.
 */
export function Badge({ children }: { readonly children: ReactNode }) {
  return <span className={styles['c-badge']}>{children}</span>;
}

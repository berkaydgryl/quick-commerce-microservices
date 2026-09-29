import type { ReactNode } from 'react';

import styles from './AuthCard.module.css';

/**
 * Giris ve kayit ekranlarinin karti (T8.5; referans: GetirMarket-Giris-Ekrani).
 * Ustte fotografsiz marka karti, altinda form. Sayfanin basligi (h1) marka
 * cumlesidir; formu adlandiran metin dugmededir.
 */
export function AuthCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles['c-auth-card']}>
      <section className={styles['c-auth-card__hero']}>
        <h1 className={styles['c-auth-card__title']}>
          Haftalık alışverişini{' '}
          <span className={styles['c-auth-card__highlight']}>en taze ürünlerle</span> yap!
        </h1>
        <p className={styles['c-auth-card__lead']}>
          Mahallendeki marketten kapına, dakikalar içinde.
        </p>
      </section>
      {children}
    </div>
  );
}

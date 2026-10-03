import { Children, Fragment } from 'react';
import type { ReactNode } from 'react';

import styles from './AuthCardLinks.module.css';

/**
 * Karsilama kartinin alt baglantilari tek satirda (T11.10'da istendi):
 * "Sifremi unuttum | Hesabin yok mu? Kayit ol →". Aralarinda ince ayrac; dar
 * ekranda sigmazsa alt alta ortalanir. Tek baglanti kalirsa (production'da
 * sifre yenileme yok) ayrac cizilmez.
 */
export function AuthCardLinks({ children }: { readonly children: ReactNode }) {
  const links = Children.toArray(children);
  return (
    <div className={styles['c-auth-card-links']}>
      {links.map((link, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className={styles['c-auth-card-links__divider']} aria-hidden="true" />
          )}
          {link}
        </Fragment>
      ))}
    </div>
  );
}

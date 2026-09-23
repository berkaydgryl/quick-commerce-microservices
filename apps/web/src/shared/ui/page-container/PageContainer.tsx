import type { ReactNode } from 'react';

import styles from './PageContainer.module.css';

/** Mobilde ekrani dolduran, genis ekranda ortalanip sinirlanan kapsayici. */
export function PageContainer({ children }: { readonly children: ReactNode }) {
  return <div className={styles['c-page-container']}>{children}</div>;
}

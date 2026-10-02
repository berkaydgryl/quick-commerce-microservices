import type { ReactNode } from 'react';

import styles from './PageContainer.module.css';

interface PageContainerProps {
  /** Cok genis ekranda (90rem ve ustu) 80rem'e kadar genisler (karsilama ekrani, T11.6). */
  readonly wide?: boolean;
  readonly children: ReactNode;
}

/** Mobilde ekrani dolduran, genis ekranda ortalanip sinirlanan kapsayici. */
export function PageContainer({ wide = false, children }: PageContainerProps) {
  const className = wide
    ? `${styles['c-page-container']} ${styles['c-page-container--wide']}`
    : styles['c-page-container'];
  return <div className={className}>{children}</div>;
}

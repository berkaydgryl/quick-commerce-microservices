import type { ReactNode } from 'react';

import styles from './PageContainer.module.css';

interface PageContainerProps {
  /** 90rem ve ustunde 80rem'e kadar genisler (karsilama T11.6; oturumlu sayfalar T11.12). */
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

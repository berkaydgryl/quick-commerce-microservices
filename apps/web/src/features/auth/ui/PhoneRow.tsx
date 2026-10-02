import type { ReactNode } from 'react';

import styles from './PhoneRow.module.css';

/** Telefon satiri (T11.6): solda ulke kodu secicisi, sagda numara alani. */
export function PhoneRow({ children }: { readonly children: ReactNode }) {
  return <div className={styles['c-phone-row']}>{children}</div>;
}

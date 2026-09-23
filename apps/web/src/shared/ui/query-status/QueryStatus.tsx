import type { ReactNode } from 'react';

import { canRetryManually } from '../../api/retryable';

import styles from './QueryStatus.module.css';

/**
 * Sorgu durumlari icin ortak mesajlar: yukleniyor, hata (+ tekrar dene), bos.
 * Metin cagirandan gelir; hata metni sunucu mesajidir (@getir/contracts
 * errors.ts), bilesen hata metni uretmez.
 */

export function QueryLoading({ children }: { readonly children: ReactNode }) {
  return (
    <p className={styles['c-query-status']} role="status">
      {children}
    </p>
  );
}

interface QueryErrorProps {
  readonly error: Error;
  readonly onRetry: () => void;
}

/** Hata mesaji; "Tekrar dene" yalnizca tekrar denemenin ise yarayabilecegi hatalarda. */
export function QueryError({ error, onRetry }: QueryErrorProps) {
  return (
    <div className={`${styles['c-query-status']} ${styles['c-query-status--error']}`} role="alert">
      <p>{error.message}</p>
      {canRetryManually(error) && (
        <button type="button" className={styles['c-query-status__retry']} onClick={onRetry}>
          Tekrar dene
        </button>
      )}
    </div>
  );
}

export function QueryEmpty({ children }: { readonly children: ReactNode }) {
  return <p className={styles['c-query-status']}>{children}</p>;
}

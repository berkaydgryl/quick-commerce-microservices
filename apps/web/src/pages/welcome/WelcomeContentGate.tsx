import type { WelcomeContent } from '@getir/contracts';
import type { ReactNode } from 'react';

import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
import { PageContainer } from '../../shared/ui/page-container/PageContainer';
import { QueryError } from '../../shared/ui/query-status/QueryStatus';

import styles from './WelcomeContentGate.module.css';

/**
 * Karsilama, giris ve kayit ekraninin ortak kapisi (T11.6): metinler icerik
 * ucundan gelir; icerik gelene kadar iskelet (mor bar, metin yok), hata olursa
 * sunucu mesaji ve "Tekrar dene". Icerik gelince ekrani cizer.
 */
export function WelcomeContentGate({
  children,
}: {
  readonly children: (content: WelcomeContent) => ReactNode;
}) {
  const { data: content, error, refetch } = useWelcomeContent();

  if (error !== null) {
    return (
      <main className={styles['c-welcome-gate__status']}>
        <PageContainer>
          <QueryError error={error} onRetry={() => void refetch()} />
        </PageContainer>
      </main>
    );
  }
  if (content === undefined) {
    return (
      <div className={styles['c-welcome-gate__skeleton']} aria-busy="true">
        <div className={styles['c-welcome-gate__skeleton-bar']} />
        <div className={`${styles['c-welcome-gate__skeleton-hero']} ${styles['is-loading']}`} />
      </div>
    );
  }
  return children(content);
}

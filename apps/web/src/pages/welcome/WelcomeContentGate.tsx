import type { WelcomeContent } from '@getir/contracts';
import type { ReactNode } from 'react';

import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
import { AppLoadingOverlay } from '../../features/content/ui/AppLoadingOverlay';
import { useLoaderVisible } from '../../shared/ui/app-loader/useLoaderVisible';
import { PageContainer } from '../../shared/ui/page-container/PageContainer';
import { QueryError } from '../../shared/ui/query-status/QueryStatus';

import styles from './WelcomeContentGate.module.css';

/**
 * Karsilama, giris ve kayit ekraninin ortak kapisi (T11.6): metinler icerik
 * ucundan gelir. Icerik gelene kadar iskelet (mor bar) ve bekleyis uzarsa
 * Yukleniyor gostergesi (F18); gosterge acikken alttaki sayfa cizilmez (banner
 * iskeleti de: yari saydam ortu tek tonda kalir; giris penceresi gostergenin
 * ustune acilmaz) ve gosterge en az suresi dolana kadar kalir. Hata olursa
 * sunucu mesaji ve "Tekrar dene"; icerik bir kez geldiyse arka plandaki yenileme
 * hatasi sayfayi silmez.
 */
export function WelcomeContentGate({
  children,
}: {
  readonly children: (content: WelcomeContent) => ReactNode;
}) {
  const { data: content, error, refetch } = useWelcomeContent();
  const loading = useLoaderVisible(content === undefined && error === null);

  if (content === undefined && error !== null) {
    return (
      <>
        <main className={styles['c-welcome-gate__status']}>
          <PageContainer>
            <QueryError error={error} onRetry={() => void refetch()} />
          </PageContainer>
        </main>
        <AppLoadingOverlay visible={loading} />
      </>
    );
  }
  return (
    <>
      {content !== undefined && !loading ? (
        children(content)
      ) : (
        <div className={styles['c-welcome-gate__skeleton']} aria-busy="true">
          <div className={styles['c-welcome-gate__skeleton-bar']} />
          {!loading && (
            <div className={`${styles['c-welcome-gate__skeleton-hero']} ${styles['is-loading']}`} />
          )}
        </div>
      )}
      <AppLoadingOverlay visible={loading} />
    </>
  );
}

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Logo } from '../logo/Logo';
import { PageContainer } from '../page-container/PageContainer';

import { useHeaderSlot } from './header-slot';
import styles from './PageLayout.module.css';

interface PageLayoutProps {
  /**
   * true: logo sayfanin ana basligidir (h1) - ana sayfa. false: logo ana sayfaya
   * baglantidir ve sayfanin h1'i icerikte durur. Her sayfada tek h1 olur.
   */
  readonly brandIsTitle?: boolean;
  readonly children: ReactNode;
}

/**
 * Sayfa iskeleti: yapiskan logolu baslik + ortalanan icerik. Basligin sag
 * ucunda uygulamanin yuvasi durur (header-slot.ts; T8.5: hesap baglantisi).
 */
export function PageLayout({ brandIsTitle = false, children }: PageLayoutProps) {
  const headerActions = useHeaderSlot();
  return (
    <>
      <header className={styles['c-page-layout__header']}>
        <PageContainer>
          <div className={styles['c-page-layout__bar']}>
            {brandIsTitle ? (
              <h1 className={styles['c-page-layout__brand']}>
                <Logo />
              </h1>
            ) : (
              <Link to="/" className={styles['c-page-layout__brand']}>
                <Logo />
              </Link>
            )}
            <div className={styles['c-page-layout__actions']}>{headerActions}</div>
          </div>
        </PageContainer>
      </header>
      <main className={styles['c-page-layout__main']}>
        <PageContainer>{children}</PageContainer>
      </main>
    </>
  );
}

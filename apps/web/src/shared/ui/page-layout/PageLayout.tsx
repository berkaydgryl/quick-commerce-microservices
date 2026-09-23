import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Logo } from '../logo/Logo';
import { PageContainer } from '../page-container/PageContainer';

import styles from './PageLayout.module.css';

interface PageLayoutProps {
  /**
   * true: logo sayfanin ana basligidir (h1) - ana sayfa. false: logo ana sayfaya
   * baglantidir ve sayfanin h1'i icerikte durur. Her sayfada tek h1 olur.
   */
  readonly brandIsTitle?: boolean;
  readonly children: ReactNode;
}

/** Sayfa iskeleti: yapiskan logolu baslik + ortalanan icerik. */
export function PageLayout({ brandIsTitle = false, children }: PageLayoutProps) {
  return (
    <>
      <header className={styles['c-page-layout__header']}>
        <PageContainer>
          {brandIsTitle ? (
            <h1 className={styles['c-page-layout__brand']}>
              <Logo />
            </h1>
          ) : (
            <Link to="/" className={styles['c-page-layout__brand']}>
              <Logo />
            </Link>
          )}
        </PageContainer>
      </header>
      <main className={styles['c-page-layout__main']}>
        <PageContainer>{children}</PageContainer>
      </main>
    </>
  );
}

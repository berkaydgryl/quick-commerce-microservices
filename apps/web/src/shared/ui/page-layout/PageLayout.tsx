import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Logo } from '../logo/Logo';
import { PageContainer } from '../page-container/PageContainer';

import { useHeaderSlots } from './header-slot';
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
 * Sayfa iskeleti (T11.10; referans getircarsi): mor, yapiskan ust bar +
 * ortalanan icerik. Bar karsilama ekranininkiyle ayni renkte; logo sari
 * "getir" + beyaz "market". Tek satir: logo | arama kutusu (icinde teslimat
 * adresi) | Profil. Telefonda iki satir: ustte logo ve Profil, altta tam
 * genislikte arama (tek satira sigmazdi). Yuvalari uygulama doldurur
 * (header-slot.ts).
 */
export function PageLayout({ brandIsTitle = false, children }: PageLayoutProps) {
  const { search, account } = useHeaderSlots();
  return (
    <>
      <header className={styles['c-page-layout__header']}>
        <PageContainer>
          <div className={styles['c-page-layout__bar']}>
            {brandIsTitle ? (
              <h1 className={styles['c-page-layout__brand']}>
                <Logo tone="inverse" />
              </h1>
            ) : (
              <Link to="/" className={styles['c-page-layout__brand']}>
                <Logo tone="inverse" />
              </Link>
            )}
            <div className={styles['c-page-layout__search']}>{search}</div>
            <div className={styles['c-page-layout__actions']}>{account}</div>
          </div>
        </PageContainer>
      </header>
      <main className={styles['c-page-layout__main']}>
        <PageContainer>{children}</PageContainer>
      </main>
    </>
  );
}

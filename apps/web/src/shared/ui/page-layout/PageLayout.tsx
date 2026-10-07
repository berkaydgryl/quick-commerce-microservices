import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { PageContainer } from '../page-container/PageContainer';

import { useHeaderSlots } from './header-slot';
import styles from './PageLayout.module.css';

/**
 * Ust bar: tam (arama ve Profil) ya da sade (sepet ve odeme: logo, adres,
 * sayfanin cipi ve Profil; T16.3, 07.10).
 */
export type PageLayoutVariant = 'full' | 'minimal';

interface PageLayoutProps {
  /**
   * true: logo sayfanin ana basligidir (h1) - ana sayfa. false: logo ana sayfaya
   * baglantidir ve sayfanin h1'i icerikte durur. Her sayfada tek h1 olur.
   */
  readonly brandIsTitle?: boolean;
  readonly variant?: PageLayoutVariant;
  /** Sade barda adresin yanindaki cip (sepetin teslim suresi); sayfa verir. */
  readonly headerExtra?: ReactNode;
  /** Sayfanin alt bilgisi (sepet ve odeme); govdenin altinda, tam genislikte. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Sayfa iskeleti (T11.10; referans getircarsi): mor, yapiskan ust bar +
 * ortalanan icerik. Bar karsilama ekranininkiyle ayni renkte; logo sari
 * "getir" + beyaz "market". Tek satir: logo | arama kutusu (icinde teslimat
 * adresi) | Profil. Telefonda iki satir: ustte logo ve Profil, altta tam
 * genislikte arama (tek satira sigmazdi). Yuvalari (logo dahil: metni
 * icerikten) uygulama doldurur (header-slot.ts).
 *
 * Sade bar (T16.3; referans getircarsi sepet sayfasi): logo, sagda beyaz
 * kutularda teslimat adresi ile sayfanin cipi ve en sagda Profil (07.10
 * kullanici istegi: Profil her sayfada; ayni hesap yuvasi); arama yok.
 *
 * Bar ve govde karsilama ekraniyla ayni genis kapsayicidadir (T11.12):
 * karsilamadan girince logo ve Profil yerinden kaymaz.
 */
export function PageLayout({
  brandIsTitle = false,
  variant = 'full',
  headerExtra,
  footer,
  children,
}: PageLayoutProps) {
  const { logo, search, account, address } = useHeaderSlots();
  const brand = brandIsTitle ? (
    <h1 className={styles['c-page-layout__brand']}>{logo}</h1>
  ) : (
    <Link to="/" className={styles['c-page-layout__brand']}>
      {logo}
    </Link>
  );
  const page = (
    <>
      <header className={styles['c-page-layout__header']}>
        <PageContainer wide>
          {variant === 'minimal' ? (
            <div
              className={`${styles['c-page-layout__bar']} ${styles['c-page-layout__bar--minimal']}`}
            >
              {brand}
              <div className={styles['c-page-layout__chips']}>
                <div className={styles['c-page-layout__chip']}>{address}</div>
                {headerExtra}
              </div>
              <div className={styles['c-page-layout__actions']}>{account}</div>
            </div>
          ) : (
            <div className={styles['c-page-layout__bar']}>
              {brand}
              <div className={styles['c-page-layout__search']}>{search}</div>
              <div className={styles['c-page-layout__actions']}>{account}</div>
            </div>
          )}
        </PageContainer>
      </header>
      <main className={styles['c-page-layout__main']}>
        <PageContainer wide>{children}</PageContainer>
      </main>
      {footer}
    </>
  );
  // Alt bilgili sayfa (sepet, odeme): kisa sayfada da alt bilgi ekranin dibinde durur.
  return footer === undefined ? page : <div className={styles['c-page-layout']}>{page}</div>;
}

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { ChevronLeftIcon } from '../../features/profile/ui/icons';

import styles from './AccountLayout.module.css';

/**
 * Hesap sayfasinin turu (T11.14 PR 2; referans getircarsi):
 *   home    - /hesabim: solda yalnizca menu, sagda profil karti
 *   section - alt sekme (Favori Isletmeler; T11.15-17'de Adreslerim, Gecmis
 *             Siparislerim, Odeme Yontemlerim): solda kart ve menu, sagda sekme
 *   nested  - sekmenin alt sayfasi (siparis detayi, kart ekle; T11.17): section
 *             gibi, ama telefonda "‹ Hesabım" yok; sayfa kendi ust sayfasina
 *             doner ("‹ Ödeme Yöntemlerim"), iki geri baglantisi ust uste binmez
 */
export type AccountLayoutVariant = 'home' | 'section' | 'nested';

export interface AccountLayoutViewProps {
  readonly variant: AccountLayoutVariant;
  /** "Hesabım": Hesabim'in basligi (h1, gorunmez) ve telefonda geri baglantisi. */
  readonly title: string | undefined;
  readonly accountHref: string;
  /** Alt sekmelerde menunun ustundeki profil karti. */
  readonly card?: ReactNode;
  readonly menu: ReactNode;
  /** Sekmenin icerigi: HER ZAMAN ortak icerik kabinin icinde. */
  readonly children: ReactNode;
}

/**
 * Hesap sayfalarinin duzeni (T11.13; T11.14 PR 2'de referansa gore). KURAL:
 * butun sekmeler sagdaki TEK icerik kabina cizer (--size-account-content);
 * sekme kendi genisligini vermez, kap sola yaslidir. Genis ekranda iki sutun
 * (menu --size-account-side, kap); telefonda tek sutun: Hesabim'da once kart,
 * sonra menu; alt sekmede yalnizca icerik ve ustte "‹ Hesabım". Durumsuz.
 */
export function AccountLayoutView({
  variant,
  title,
  accountHref,
  card,
  menu,
  children,
}: AccountLayoutViewProps) {
  const section = variant !== 'home';
  const block = section
    ? `${styles['c-account-layout']} ${styles['c-account-layout--section']}`
    : styles['c-account-layout'];
  return (
    <div className={block}>
      <aside className={styles['c-account-layout__side']}>
        {section && card}
        {menu}
      </aside>
      <div className={styles['c-account-layout__main']}>
        {variant === 'home' && title !== undefined && (
          <h1 className={styles['c-account-layout__title']}>{title}</h1>
        )}
        {variant === 'section' && title !== undefined && (
          <NavLink to={accountHref} end className={() => styles['c-account-layout__back']}>
            <span className={styles['c-account-layout__back-icon']}>
              <ChevronLeftIcon />
            </span>
            {title}
          </NavLink>
        )}
        {children}
      </div>
    </div>
  );
}

import type { AccountMenuContent } from '@getir/contracts';
import { NavLink } from 'react-router-dom';

import { accountMenuLinks } from './account-menu';
import styles from './AccountLayout.module.css';

const menuItem = ({ isActive }: { readonly isActive: boolean }) =>
  isActive
    ? `${styles['c-account-layout__item']} ${styles['is-active']}`
    : styles['c-account-layout__item'];

/**
 * Hesap sayfalarinin sol menusu (T11.16'dan beri ortak liste, accountMenuItems):
 * Profilim, Adreslerim, Favori İşletmeler, Geçmiş Siparişlerim. Gecerli sayfa
 * vurgulu; Profilim yalnizca /hesabim'de.
 */
export function AccountMenu({ texts }: { readonly texts: AccountMenuContent }) {
  return (
    <nav className={styles['c-account-layout__menu']} aria-label={texts.label}>
      <ul className={styles['c-account-layout__list']} role="list">
        {accountMenuLinks(texts).map((link) => (
          <li key={link.href} className={styles['c-account-layout__entry']}>
            <NavLink to={link.href} end={link.end} className={menuItem}>
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { ADDRESSES_PATH } from '../../features/address/routes';
import { AUTH_ROUTES } from '../../features/auth/routes';
import { useAccountTitle } from '../../features/content/hooks/useAccountTitle';
import { useFavoritesContent } from '../../features/content/hooks/useFavoritesContent';
import { FAVORITES_PATH } from '../../features/favorites/routes';
import { ProfileCard } from '../../features/profile/ui/ProfileCard';

import styles from './AccountLayout.module.css';
import { AccountLayoutView } from './AccountLayoutView';
import type { AccountLayoutVariant } from './AccountLayoutView';

interface AccountLayoutProps {
  readonly userId: string;
  readonly variant: AccountLayoutVariant;
  readonly children: ReactNode;
}

const menuItem = ({ isActive }: { readonly isActive: boolean }) =>
  isActive
    ? `${styles['c-account-layout__item']} ${styles['is-active']}`
    : styles['c-account-layout__item'];

/**
 * Profil sayfalarinin duzeni (T11.13; T11.14 PR 2): gorunum AccountLayoutView'da,
 * burada metinler, kart ve menu baglanir. Menude yalnizca calisanlar (karar
 * D4): "Adreslerim" sekmesi (T11.15) ve "Favori Isletmeler".
 */
export function AccountLayout({ userId, variant, children }: AccountLayoutProps) {
  const texts = useFavoritesContent();
  const title = useAccountTitle();

  return (
    <AccountLayoutView
      variant={variant}
      title={title}
      accountHref={AUTH_ROUTES.account}
      card={<ProfileCard userId={userId} />}
      menu={
        texts !== undefined && (
          <nav className={styles['c-account-layout__menu']} aria-label={texts.profileMenuLabel}>
            <ul className={styles['c-account-layout__list']} role="list">
              <li className={styles['c-account-layout__entry']}>
                <NavLink to={ADDRESSES_PATH} className={menuItem}>
                  {texts.addressesLabel}
                </NavLink>
              </li>
              <li className={styles['c-account-layout__entry']}>
                <NavLink to={FAVORITES_PATH} className={menuItem}>
                  {texts.favoritesMenuLabel}
                </NavLink>
              </li>
            </ul>
          </nav>
        )
      }
    >
      {children}
    </AccountLayoutView>
  );
}

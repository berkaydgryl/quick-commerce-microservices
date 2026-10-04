import type { ReactNode } from 'react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';

import { useAddressBook } from '../../features/address/hooks/useAddressBook';
import { AddressDialogs } from '../../features/address/ui/AddressDialogs';
import type { AddressDialog } from '../../features/address/ui/AddressDialogs';
import { useProfile } from '../../features/auth/hooks/useProfile';
import { AUTH_ROUTES } from '../../features/auth/routes';
import { formatPhone } from '../../features/auth/services/phone';
import { UserIcon } from '../../features/auth/ui/icons';
import { useFavoritesContent } from '../../features/content/hooks/useFavoritesContent';
import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
import { FAVORITES_PATH } from '../../features/favorites/routes';

import styles from './AccountLayout.module.css';

interface AccountLayoutProps {
  readonly userId: string;
  readonly children: ReactNode;
}

const menuItem = ({ isActive }: { readonly isActive: boolean }) =>
  isActive
    ? `${styles['c-account-layout__item']} ${styles['is-active']}`
    : styles['c-account-layout__item'];

/**
 * Profil sayfasinin duzeni (T11.13; referans getircarsi): solda profil karti
 * (ad, telefon; Hesabim'a gider) ve menu, sagda sayfanin icerigi. Menude
 * yalnizca calisanlar (karar D4): "Adreslerim" ust bardaki "Adreslerim"
 * penceresini acar, "Favori Isletmeler" favori sayfasina gider. Genis
 * ekranda iki sutun (1:3), telefonda alt alta.
 */
export function AccountLayout({ userId, children }: AccountLayoutProps) {
  const texts = useFavoritesContent();

  return (
    <div className={styles['c-account-layout']}>
      <aside className={styles['c-account-layout__side']}>
        <ProfileCard userId={userId} />
        {texts !== undefined && (
          <nav className={styles['c-account-layout__menu']} aria-label={texts.profileMenuLabel}>
            <ul className={styles['c-account-layout__list']} role="list">
              <li>
                <AddressesMenuItem userId={userId} label={texts.addressesLabel} />
              </li>
              <li>
                <NavLink to={FAVORITES_PATH} className={menuItem}>
                  {texts.favoritesMenuLabel}
                </NavLink>
              </li>
            </ul>
          </nav>
        )}
      </aside>
      <div className={styles['c-account-layout__main']}>{children}</div>
    </div>
  );
}

/** Profil karti: ad ve telefon (GET /v1/me); Hesabim sayfasina baglanti. */
function ProfileCard({ userId }: { readonly userId: string }) {
  const profile = useProfile(userId);
  return (
    <NavLink to={AUTH_ROUTES.account} end className={() => styles['c-account-layout__profile']}>
      <span className={styles['c-account-layout__avatar']}>
        <UserIcon />
      </span>
      <span className={styles['c-account-layout__identity']} aria-busy={profile.isPending}>
        {profile.data !== undefined && (
          <>
            <span className={styles['c-account-layout__name']}>{profile.data.fullName}</span>
            <span className={styles['c-account-layout__phone']}>
              {formatPhone(profile.data.phone)}
            </span>
          </>
        )}
      </span>
    </NavLink>
  );
}

/**
 * "Adreslerim": ust bardaki pencerelerin aynisi (AddressDialogs). Defter bu
 * menude tek gozlemciyle okunur; pencerenin metinleri icerikten, icerik
 * gelmeden dugme basilamaz.
 */
function AddressesMenuItem({ userId, label }: { readonly userId: string; readonly label: string }) {
  const book = useAddressBook();
  const { data: content } = useWelcomeContent();
  const [open, setOpen] = useState<AddressDialog | undefined>();

  return (
    <>
      <button
        type="button"
        className={styles['c-account-layout__item']}
        aria-haspopup="dialog"
        disabled={content === undefined}
        onClick={() => setOpen('book')}
      >
        {label}
      </button>
      {open !== undefined && content !== undefined && (
        <AddressDialogs
          book={book}
          content={content.appHeader}
          setup={content.addressSetup}
          closeLabel={content.loginCard.closeLabel}
          userId={userId}
          open={open}
          onOpen={setOpen}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

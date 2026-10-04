import type { ReactNode } from 'react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';

import { useAddressBook } from '../../features/address/hooks/useAddressBook';
import { AddressDialogs } from '../../features/address/ui/AddressDialogs';
import type { AddressDialog } from '../../features/address/ui/AddressDialogs';
import { AUTH_ROUTES } from '../../features/auth/routes';
import { useAccountTitle } from '../../features/content/hooks/useAccountTitle';
import { useFavoritesContent } from '../../features/content/hooks/useFavoritesContent';
import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
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
 * D4): "Adreslerim" ust bardaki "Adreslerim" penceresini acar (T11.15'te
 * sekme olur), "Favori Isletmeler" favori sayfasina gider.
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
                <AddressesMenuItem userId={userId} label={texts.addressesLabel} />
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

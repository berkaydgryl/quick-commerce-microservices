import { useId } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useSessionStore } from '../../../shared/session/session-store';
import { useDisclosure } from '../../../shared/ui/disclosure/useDisclosure';
import { useLogout } from '../hooks/useLogout';
import { AUTH_ROUTES } from '../routes';
import { loginPathFor } from '../services/next-path';

import styles from './HeaderAccount.module.css';
import { ChevronDownIcon, UserIcon } from './icons';

/**
 * Hesap alaninin metinleri. Icerikten gelir (appHeader + header.loginLabel);
 * icerik ucu hata verirse uygulama yedek sozlugu verir (T11.10 duzeltmesi):
 * oturumdaki kullanici her durumda cikis yapabilir ve Hesabim'a gidebilir.
 */
export interface HeaderAccountTexts {
  readonly loginLabel: string;
  readonly profileLabel: string;
  readonly accountLabel: string;
  readonly logoutLabel: string;
  readonly logoutPendingLabel: string;
}

interface HeaderAccountProps {
  /** Metinler; icerik gelene kadar undefined (yer tutucu). */
  readonly texts: HeaderAccountTexts | undefined;
}

/**
 * Ust barin hesap alani (T8.5; T11.10'dan beri Profil menusu; referans
 * getircarsi "👤 Profil ▾"): oturumdayken menu ("Hesabim", "Cikis yap"),
 * oturumsuzken "Giris yap" (karsilama ekrani, donus bu sayfa). Acilistaki
 * sessiz yenileme ve icerik bitene kadar ayni boyda bos yer: bar kaymaz. Dar
 * ekranda yalnizca ikon gorunur; adi aria-label tasir.
 */
export function HeaderAccount({ texts }: HeaderAccountProps) {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

  if (status === 'unknown' || texts === undefined) {
    return <span className={styles['c-header-account__placeholder']} aria-hidden="true" />;
  }
  if (status === 'anonymous') {
    return (
      <Link
        to={loginPathFor(location)}
        className={styles['c-header-account']}
        aria-label={texts.loginLabel}
      >
        <span className={styles['c-header-account__icon']}>
          <UserIcon />
        </span>
        <span className={styles['c-header-account__text']}>{texts.loginLabel}</span>
      </Link>
    );
  }
  return <ProfileMenu texts={texts} />;
}

/**
 * Profil menusu: dugme ve altinda saga yasli liste. Cikis basarisizsa (ag,
 * 503) oturum yerinde kalir ve mesaj listede gorunur (useLogout).
 */
function ProfileMenu({ texts }: { readonly texts: HeaderAccountTexts }) {
  const disclosure = useDisclosure();
  const logout = useLogout();
  const panelId = useId();

  return (
    <div ref={disclosure.rootRef} className={styles['c-header-account__menu']}>
      <button
        ref={disclosure.toggleRef}
        type="button"
        className={styles['c-header-account']}
        aria-label={texts.profileLabel}
        aria-expanded={disclosure.open}
        aria-controls={panelId}
        onClick={disclosure.toggle}
      >
        <span className={styles['c-header-account__icon']}>
          <UserIcon />
        </span>
        <span className={styles['c-header-account__text']}>{texts.profileLabel}</span>
        <span className={styles['c-header-account__chevron']}>
          <ChevronDownIcon />
        </span>
      </button>
      <div id={panelId} className={styles['c-header-account__panel']} hidden={!disclosure.open}>
        <ul className={styles['c-header-account__list']} role="list">
          <li>
            <Link
              to={AUTH_ROUTES.account}
              className={styles['c-header-account__item']}
              onClick={disclosure.close}
            >
              {texts.accountLabel}
            </Link>
          </li>
          <li>
            <button
              type="button"
              className={styles['c-header-account__item']}
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {logout.isPending ? texts.logoutPendingLabel : texts.logoutLabel}
            </button>
          </li>
        </ul>
        {logout.error !== null && (
          <p className={styles['c-header-account__error']} role="alert">
            {logout.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

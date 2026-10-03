import type { AppHeaderContent } from '@getir/contracts';
import { useId } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useSessionStore } from '../../../shared/session/session-store';
import { useDisclosure } from '../../../shared/ui/disclosure/useDisclosure';
import { useLogout } from '../hooks/useLogout';
import { AUTH_ROUTES } from '../routes';
import { loginPathFor } from '../services/next-path';

import styles from './HeaderAccount.module.css';
import { ChevronDownIcon, UserIcon } from './icons';

interface HeaderAccountProps {
  /** Ust bar metinleri; icerik gelene kadar undefined (yer tutucu). */
  readonly content: AppHeaderContent | undefined;
  /** "Giris yap" (icerik: header.loginLabel). */
  readonly loginLabel: string | undefined;
}

/**
 * Ust barin hesap alani (T8.5; T11.10'dan beri Profil menusu; referans
 * getircarsi "👤 Profil ▾"): oturumdayken menu ("Hesabim", "Cikis yap"),
 * oturumsuzken "Giris yap" (karsilama ekrani, donus bu sayfa). Acilistaki
 * sessiz yenileme ve icerik bitene kadar ayni boyda bos yer: bar kaymaz. Dar
 * ekranda yalnizca ikon gorunur; adi aria-label tasir.
 */
export function HeaderAccount({ content, loginLabel }: HeaderAccountProps) {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

  if (status === 'unknown' || content === undefined || loginLabel === undefined) {
    return <span className={styles['c-header-account__placeholder']} aria-hidden="true" />;
  }
  if (status === 'anonymous') {
    return (
      <Link
        to={loginPathFor(location)}
        className={styles['c-header-account']}
        aria-label={loginLabel}
      >
        <span className={styles['c-header-account__icon']}>
          <UserIcon />
        </span>
        <span className={styles['c-header-account__text']}>{loginLabel}</span>
      </Link>
    );
  }
  return <ProfileMenu content={content} />;
}

/**
 * Profil menusu: dugme ve altinda saga yasli liste. Cikis basarisizsa (ag,
 * 503) oturum yerinde kalir ve mesaj listede gorunur (useLogout).
 */
function ProfileMenu({ content }: { readonly content: AppHeaderContent }) {
  const disclosure = useDisclosure();
  const logout = useLogout();
  const panelId = useId();

  return (
    <div ref={disclosure.rootRef} className={styles['c-header-account__menu']}>
      <button
        ref={disclosure.toggleRef}
        type="button"
        className={styles['c-header-account']}
        aria-label={content.profileLabel}
        aria-expanded={disclosure.open}
        aria-controls={panelId}
        onClick={disclosure.toggle}
      >
        <span className={styles['c-header-account__icon']}>
          <UserIcon />
        </span>
        <span className={styles['c-header-account__text']}>{content.profileLabel}</span>
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
              {content.accountLabel}
            </Link>
          </li>
          <li>
            <button
              type="button"
              className={styles['c-header-account__item']}
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {logout.isPending ? content.logoutPendingLabel : content.logoutLabel}
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

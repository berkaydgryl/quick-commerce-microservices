import { Link, useLocation } from 'react-router-dom';

import { useSessionStore } from '../../../shared/session/session-store';
import { AUTH_ROUTES } from '../routes';
import { loginPathFor } from '../services/next-path';

import styles from './HeaderAccount.module.css';
import { UserIcon } from './icons';

/** Kimlik ekranlarinda baslikta hesap alani yoktur: kullanici zaten orada. */
const HIDDEN_ON: ReadonlySet<string> = new Set([AUTH_ROUTES.login, AUTH_ROUTES.register]);

/**
 * Basligin hesap alani (T8.5): oturumsuzken "Giris yap" (donus adresi bu
 * sayfa), oturumdayken "Hesabim". Acilistaki sessiz yenileme bitene kadar
 * ayni boyutta bos bir yer tutar: cevap gelince baslik kaymaz.
 * Dar ekranda yalnizca ikon gorunur; adi aria-label tasir.
 */
export function HeaderAccount() {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

  if (HIDDEN_ON.has(location.pathname)) {
    return null;
  }
  if (status === 'unknown') {
    return <span className={styles['c-header-account__placeholder']} aria-hidden="true" />;
  }

  const signedIn = status === 'authenticated';
  const label = signedIn ? 'Hesabım' : 'Giriş yap';
  return (
    <Link
      to={signedIn ? AUTH_ROUTES.account : loginPathFor(location)}
      className={styles['c-header-account']}
      aria-label={label}
    >
      <span className={styles['c-header-account__icon']}>
        <UserIcon />
      </span>
      <span className={styles['c-header-account__text']}>{label}</span>
    </Link>
  );
}

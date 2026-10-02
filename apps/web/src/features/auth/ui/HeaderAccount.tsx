import { Link, useLocation } from 'react-router-dom';

import { useSessionStore } from '../../../shared/session/session-store';
import { AUTH_ROUTES } from '../routes';
import { loginPathFor } from '../services/next-path';

import styles from './HeaderAccount.module.css';
import { UserIcon } from './icons';

/**
 * Basligin hesap alani (T8.5): oturumsuzken "Giris yap" (karsilama ekrani,
 * donus adresi bu sayfa; T11.6), oturumdayken "Hesabim". Karsilama ekraninin
 * kendi ust bari vardir; bu alan orada cizilmez. Acilistaki sessiz yenileme
 * bitene kadar ayni boyutta bos bir yer tutar: cevap gelince baslik kaymaz.
 * Dar ekranda yalnizca ikon gorunur; adi aria-label tasir.
 */
export function HeaderAccount() {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

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

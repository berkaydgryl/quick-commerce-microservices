import { Link } from 'react-router-dom';

import styles from './ForgotPasswordLink.module.css';
import type { AuthSwitchTarget } from './PhoneNotice';

interface ForgotPasswordLinkProps {
  /** "Sifremi unuttum" (icerikten). */
  readonly label: string;
  /** Sifre yenileme penceresi; yazilan numara ve pencerenin nereden acildigi tasinir. */
  readonly target: AuthSwitchTarget;
  /** 'end': giris penceresinde sifre alaninin altinda saga yasli; 'center': karsilama kartinda. */
  readonly align: 'end' | 'center';
  /** Pencereden pencereye gecis adresi degistirir (true); karttan acilis yeni gecmis kaydidir (false). */
  readonly replace: boolean;
}

/**
 * "Sifremi unuttum" baglantisi (T11.9): giris penceresinde ve karsilama
 * kartinda. Yalnizca gelistirme paketinde cizilir (__DEMO_PASSWORD_RESET__;
 * cagiran karar verir).
 */
export function ForgotPasswordLink({ label, target, align, replace }: ForgotPasswordLinkProps) {
  return (
    <p
      className={`${styles['c-forgot-password']} ${
        styles[align === 'end' ? 'c-forgot-password--end' : 'c-forgot-password--center']
      }`}
    >
      <Link
        to={target.to}
        state={target.state}
        replace={replace}
        className={styles['c-forgot-password__link']}
      >
        {label}
      </Link>
    </p>
  );
}

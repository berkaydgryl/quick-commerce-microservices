import { Link } from 'react-router-dom';

import type { AuthRouteState } from '../services/auth-route-state';

import { ArrowRightIcon } from './icons';
import styles from './PhoneNotice.module.css';

/** Karsi pencerenin adresi ve ona tasinan gecmis durumu (yazilan numara). */
export interface AuthSwitchTarget {
  readonly to: string;
  readonly state: AuthRouteState;
}

interface PhoneNoticeProps {
  /** "Bu numarayla kayitli bir hesap var." (icerikten). */
  readonly message: string;
  /** "Giris yap" (icerikten). */
  readonly linkLabel: string;
  readonly target: AuthSwitchTarget;
}

/**
 * Telefonun altindaki erken uyari (T11.7): numara yazilinca sunucu "kayitli"
 * ya da "kayitsiz" dediyse, karsi pencereye numarayla gecen baglantiyla.
 * Ekran okuyucu durumu nazikce duyurur (role="status").
 */
export function PhoneNotice({ message, linkLabel, target }: PhoneNoticeProps) {
  return (
    <p className={styles['c-phone-notice']} role="status">
      {message}{' '}
      <Link to={target.to} state={target.state} replace className={styles['c-phone-notice__link']}>
        {linkLabel}
        <span className={styles['c-phone-notice__icon']}>
          <ArrowRightIcon />
        </span>
      </Link>
    </p>
  );
}

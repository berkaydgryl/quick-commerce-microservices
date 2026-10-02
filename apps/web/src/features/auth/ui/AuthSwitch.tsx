import { Link } from 'react-router-dom';

import type { AuthRouteState } from '../services/auth-route-state';

import styles from './AuthSwitch.module.css';
import { ArrowRightIcon } from './icons';

interface AuthSwitchProps {
  /** "Hesabin yok mu?" (icerikten). */
  readonly prompt: string;
  /** "Kayit ol" (icerikten). */
  readonly label: string;
  /** Karsi pencerenin adresi; donus adresini tasir. */
  readonly to: string;
  /** Yazilan numara ve pencerenin nereden acildigi karsi pencereye tasinir. */
  readonly state: AuthRouteState;
  /**
   * true (varsayilan, pencereler arasi gecis): adres DEGISTIRILIR, geri tusu
   * pencereler arasinda gidip gelmez. false (karsilama kartindan pencere
   * acilisi): yeni gecmis kaydi, geri tusu pencereyi kapatir.
   */
  readonly replace?: boolean;
}

/**
 * Karsi ekrana gecis ("Hesabin yok mu? Kayit ol →"): pencerenin alt bandinda
 * ve karsilama kartinin altinda.
 */
export function AuthSwitch({ prompt, label, to, state, replace = true }: AuthSwitchProps) {
  return (
    <p className={styles['c-auth-switch']}>
      {prompt}{' '}
      <Link to={to} state={state} replace={replace} className={styles['c-auth-switch__link']}>
        {label}
        <span className={styles['c-auth-switch__icon']}>
          <ArrowRightIcon />
        </span>
      </Link>
    </p>
  );
}

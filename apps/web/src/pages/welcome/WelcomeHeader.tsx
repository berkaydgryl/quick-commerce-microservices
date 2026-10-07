import type { WelcomeContent } from '@getir/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { AUTH_ROUTES } from '../../features/auth/routes';
import type { AuthRouteState } from '../../features/auth/services/auth-route-state';
import { withNextPath } from '../../features/auth/services/next-path';
import { UserIcon, UserPlusIcon } from '../../features/auth/ui/icons';
import { Logo } from '../../shared/ui/logo/Logo';
import { PageContainer } from '../../shared/ui/page-container/PageContainer';

import styles from './WelcomeHeader.module.css';

interface WelcomeHeaderProps {
  readonly header: WelcomeContent['header'];
  /** Giristen ya da kayittan sonra donulecek adres; baglantilar tasir. */
  readonly next?: string;
  /** Pencereye tasinan gecmis durumu (pencere uygulama icinden acildi). */
  readonly linkState?: AuthRouteState;
  /**
   * Oturum aciksa (adres kurulumu ekrani) sagda "Giriş yap / Kayıt ol" yerine
   * uygulamanin hesap alani (Profil menusu; 07.10 kullanici istegi). Oturumsuzken
   * yok (undefined ya da null: baglantilar).
   */
  readonly account?: ReactNode;
}

/**
 * Karsilama ekraninin ust bari (T11.6): solda logo, sagda "Giris yap" (/giris)
 * ve "Kayit ol" (/kayit); ikisi de ekranin ustunde pencere acar. Oturum aciksa
 * (adres kurulumu) bunlarin yerine Profil menusu. Dil secici ve konum arama
 * YOK (PRD).
 */
export function WelcomeHeader({ header, next = '/', linkState, account }: WelcomeHeaderProps) {
  return (
    <header className={styles['c-welcome-header']}>
      <PageContainer wide>
        <div className={styles['c-welcome-header__bar']}>
          <Link to={AUTH_ROUTES.welcome} className={styles['c-welcome-header__brand']}>
            <Logo brand={header.brand} service={header.service} tone="inverse" />
          </Link>
          {account === undefined || account === null ? (
            <nav className={styles['c-welcome-header__actions']}>
              <Link
                to={withNextPath(AUTH_ROUTES.login, next)}
                state={linkState}
                className={styles['c-welcome-header__action']}
              >
                <span className={styles['c-welcome-header__icon']}>
                  <UserIcon />
                </span>
                {header.loginLabel}
              </Link>
              <Link
                to={withNextPath(AUTH_ROUTES.register, next)}
                state={linkState}
                className={styles['c-welcome-header__action']}
              >
                <span className={styles['c-welcome-header__icon']}>
                  <UserPlusIcon />
                </span>
                {header.registerLabel}
              </Link>
            </nav>
          ) : (
            <div className={styles['c-welcome-header__actions']}>{account}</div>
          )}
        </div>
      </PageContainer>
    </header>
  );
}

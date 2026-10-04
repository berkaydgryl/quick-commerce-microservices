import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

import { QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useAccountContent } from '../../content/hooks/useAccountContent';
import { useProfileContent } from '../../content/hooks/useProfileContent';
import { useLogout } from '../hooks/useLogout';
import { useProfile } from '../hooks/useProfile';
import { formatPhone } from '../services/phone';

import styles from './AccountPanel.module.css';

/** Cikis hatasinin sozlukteki karsiligi; beklenmeyen hata INTERNAL. */
function logoutErrorMessage(error: Error): string {
  return errorMessage(error instanceof AppError ? error.code : ERROR_CODES.INTERNAL);
}

/**
 * Hesabim (T8.5): ad, telefon, dogrulanmis e-posta (T11.14) ve cikis. Profil
 * /v1/me'den gelir; erisim jetonunun suresi dolmussa yetkili istemci sessizce
 * yeniler. Metinler T11.14'ten beri icerikten (gelmezse yedek): ekranda sabit
 * metin yok.
 */
export function AccountPanel({ userId }: { readonly userId: string }) {
  const profile = useProfile(userId);
  const logout = useLogout();
  const account = useAccountContent();
  const texts = useProfileContent();

  if (account === undefined || texts === undefined) {
    return null;
  }
  return (
    <section className={styles['c-account-panel']}>
      <h1 className={styles['c-account-panel__title']}>{account.title}</h1>
      {profile.isPending && <QueryLoading>{texts.loadingLabel}</QueryLoading>}
      {profile.isError && (
        <QueryError error={profile.error} onRetry={() => void profile.refetch()} />
      )}
      {profile.isSuccess && (
        <dl className={styles['c-account-panel__details']}>
          <div className={styles['c-account-panel__row']}>
            <dt className={styles['c-account-panel__term']}>{texts.fullNameLabel}</dt>
            <dd className={styles['c-account-panel__value']}>{profile.data.fullName}</dd>
          </div>
          <div className={styles['c-account-panel__row']}>
            <dt className={styles['c-account-panel__term']}>{texts.phoneLabel}</dt>
            <dd className={styles['c-account-panel__value']}>{formatPhone(profile.data.phone)}</dd>
          </div>
          {profile.data.email !== undefined && (
            <div className={styles['c-account-panel__row']}>
              <dt className={styles['c-account-panel__term']}>{texts.emailLabel}</dt>
              <dd className={styles['c-account-panel__value']}>{profile.data.email}</dd>
            </div>
          )}
        </dl>
      )}
      {logout.isError && (
        <p className={styles['c-account-panel__error']} role="alert">
          {logoutErrorMessage(logout.error)}
        </p>
      )}
      <button
        type="button"
        className={styles['c-account-panel__logout']}
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {logout.isPending ? account.logoutPendingLabel : account.logoutLabel}
      </button>
    </section>
  );
}

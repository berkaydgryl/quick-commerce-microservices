import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

import { QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useLogout } from '../hooks/useLogout';
import { useProfile } from '../hooks/useProfile';
import { formatPhone } from '../services/phone';

import styles from './AccountPanel.module.css';

/** Cikis hatasinin sozlukteki karsiligi; beklenmeyen hata INTERNAL. */
function logoutErrorMessage(error: Error): string {
  return errorMessage(error instanceof AppError ? error.code : ERROR_CODES.INTERNAL);
}

/**
 * Hesabim (T8.5): ad, telefon ve cikis. Profil /v1/me'den gelir; erisim
 * jetonunun suresi dolmussa yetkili istemci sessizce yeniler.
 */
export function AccountPanel({ userId }: { readonly userId: string }) {
  const profile = useProfile(userId);
  const logout = useLogout();

  return (
    <section className={styles['c-account-panel']}>
      <h1 className={styles['c-account-panel__title']}>Hesabım</h1>
      {profile.isPending && <QueryLoading>Bilgilerin yükleniyor…</QueryLoading>}
      {profile.isError && (
        <QueryError error={profile.error} onRetry={() => void profile.refetch()} />
      )}
      {profile.isSuccess && (
        <dl className={styles['c-account-panel__details']}>
          <div className={styles['c-account-panel__row']}>
            <dt className={styles['c-account-panel__term']}>Ad soyad</dt>
            <dd className={styles['c-account-panel__value']}>{profile.data.fullName}</dd>
          </div>
          <div className={styles['c-account-panel__row']}>
            <dt className={styles['c-account-panel__term']}>Telefon</dt>
            <dd className={styles['c-account-panel__value']}>{formatPhone(profile.data.phone)}</dd>
          </div>
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
        {logout.isPending ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
      </button>
    </section>
  );
}

import { AccountPanel } from '../../features/auth/ui/AccountPanel';
import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useSessionStore } from '../../shared/session/session-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { AccountLayout } from './AccountLayout';

/** /hesabim (T8.5): korumali; oturum yoksa giris ekranina, girisle buraya geri. */
export function AccountPage() {
  return (
    <PageLayout>
      <RequireAuth>
        <SignedInAccount />
      </RequireAuth>
    </PageLayout>
  );
}

/**
 * RequireAuth yalnizca oturum acikken cizer: kullanici burada hep vardir.
 * T11.13'ten beri profil duzeninde (solda profil karti ve menu).
 */
function SignedInAccount() {
  const userId = useSessionStore((state) => state.user?.id);
  return userId === undefined ? null : (
    <AccountLayout userId={userId}>
      <AccountPanel userId={userId} />
    </AccountLayout>
  );
}

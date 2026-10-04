import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { ProfileCard } from '../../features/profile/ui/ProfileCard';
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
 * T11.14 PR 2'den beri (referans getircarsi): solda menu, ortak icerik kabinda
 * profil karti. Eski "Hesabım" paneli (ad, telefon, cikis) kalkti: bilgiler
 * kartta, cikis ust barin Profil menusunde.
 */
function SignedInAccount() {
  const userId = useSessionStore((state) => state.user?.id);
  return userId === undefined ? null : (
    <AccountLayout userId={userId} variant="home">
      <ProfileCard userId={userId} onAccountPage />
    </AccountLayout>
  );
}

import { useState } from 'react';

import { useProfile } from '../../auth/hooks/useProfile';
import { AUTH_ROUTES } from '../../auth/routes';
import { useProfileContent } from '../../content/hooks/useProfileContent';

import { EditProfileDialog } from './EditProfileDialog';
import type { CodeWindows, EditProfileStep } from './EditProfileDialog';
import { ProfileCardView } from './ProfileCardView';

interface ProfileCardProps {
  readonly userId: string;
  /**
   * Kart Hesabim'in kendisinde mi (ortak icerik kabinda; ad duz metin) yoksa
   * bir alt sekmede mi (menunun ustunde; ad Hesabim'a gider). T11.14 PR 2.
   */
  readonly onAccountPage?: boolean;
}

/** Hic kod gonderilmemis. */
const NO_WINDOWS: CodeWindows = { email: undefined, phone: undefined };

/**
 * Profil karti ve "Profili düzenle" penceresi (T11.14; pencere PR 3). Profil
 * GET /v1/me'den; metinler icerikten (gelmezse yedek). Son gonderilen kodlarin
 * pencereleri burada tutulur: pencere kapatilip acilinca kod adimi surer.
 */
export function ProfileCard({ userId, onAccountPage = false }: ProfileCardProps) {
  const profile = useProfile(userId);
  const texts = useProfileContent();
  const [open, setOpen] = useState<EditProfileStep | undefined>();
  const [windows, setWindows] = useState<CodeWindows>(NO_WINDOWS);

  if (texts === undefined) {
    return null;
  }
  return (
    <>
      <ProfileCardView
        profile={profile.data}
        texts={texts}
        accountHref={onAccountPage ? undefined : AUTH_ROUTES.account}
        onEdit={() => setOpen('overview')}
        onAddEmail={() => setOpen('email')}
        onVerifyPhone={() => setOpen('phone-verify')}
      />
      {open !== undefined && profile.data !== undefined && (
        <EditProfileDialog
          userId={userId}
          profile={profile.data}
          texts={texts}
          initialStep={open}
          windows={windows}
          onWindows={setWindows}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

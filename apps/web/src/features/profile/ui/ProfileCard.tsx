import { useState } from 'react';

import { useProfile } from '../../auth/hooks/useProfile';
import { AUTH_ROUTES } from '../../auth/routes';
import { useProfileContent } from '../../content/hooks/useProfileContent';
import type { CodeWindow } from '../services/code-window';

import { EmailDialog } from './EmailDialog';
import { ProfileCardView } from './ProfileCardView';

interface ProfileCardProps {
  readonly userId: string;
  /**
   * Kart Hesabim'in kendisinde mi (ortak icerik kabinda; ad duz metin) yoksa
   * bir alt sekmede mi (menunun ustunde; ad Hesabim'a gider). T11.14 PR 2.
   */
  readonly onAccountPage?: boolean;
}

/**
 * Profil karti ve e-posta penceresi (T11.14). Profil GET /v1/me'den; metinler
 * icerikten (gelmezse yedek). Son gonderilen kodun penceresi burada tutulur:
 * pencere kapatilip acilinca kod adimi kaldigi yerden surer.
 */
export function ProfileCard({ userId, onAccountPage = false }: ProfileCardProps) {
  const profile = useProfile(userId);
  const texts = useProfileContent();
  const [open, setOpen] = useState(false);
  const [codeWindow, setCodeWindow] = useState<CodeWindow | undefined>();

  if (texts === undefined) {
    return null;
  }
  return (
    <>
      <ProfileCardView
        profile={profile.data}
        texts={texts}
        accountHref={onAccountPage ? undefined : AUTH_ROUTES.account}
        onEditEmail={() => setOpen(true)}
      />
      {open && (
        <EmailDialog
          userId={userId}
          texts={texts.emailDialog}
          window={codeWindow}
          onWindow={setCodeWindow}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

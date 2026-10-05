import type { ReactNode } from 'react';

import { AUTH_ROUTES } from '../../features/auth/routes';
import { useAccountMenuContent } from '../../features/content/hooks/useAccountMenuContent';
import { useAccountTitle } from '../../features/content/hooks/useAccountTitle';
import { ProfileCard } from '../../features/profile/ui/ProfileCard';

import { AccountLayoutView } from './AccountLayoutView';
import type { AccountLayoutVariant } from './AccountLayoutView';
import { AccountMenu } from './AccountMenu';

interface AccountLayoutProps {
  readonly userId: string;
  readonly variant: AccountLayoutVariant;
  readonly children: ReactNode;
}

/**
 * Profil sayfalarinin duzeni (T11.13; T11.14 PR 2): gorunum AccountLayoutView'da,
 * burada metinler, kart ve menu baglanir. Menu ust barin Profil menusuyle ayni
 * listeden (T11.16, accountMenuItems).
 */
export function AccountLayout({ userId, variant, children }: AccountLayoutProps) {
  const menu = useAccountMenuContent();
  const title = useAccountTitle();

  return (
    <AccountLayoutView
      variant={variant}
      title={title}
      accountHref={AUTH_ROUTES.account}
      card={<ProfileCard userId={userId} />}
      menu={menu !== undefined && <AccountMenu texts={menu} />}
    >
      {children}
    </AccountLayoutView>
  );
}

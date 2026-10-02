import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

import { DemoPersonaPicker } from '../../features/auth/demo/DemoPersonaPicker';
import { DEMO_PASSWORD } from '../../features/auth/demo/personas';
import { useCloseAuthDialog } from '../../features/auth/hooks/useCloseAuthDialog';
import { AUTH_ROUTES, NEXT_PARAM } from '../../features/auth/routes';
import { readAuthRouteState } from '../../features/auth/services/auth-route-state';
import type { PhoneEntry } from '../../features/auth/services/auth-route-state';
import { safeNextPath, withNextPath } from '../../features/auth/services/next-path';
import { AuthDialog } from '../../features/auth/ui/AuthDialog';
import { AuthSwitch } from '../../features/auth/ui/AuthSwitch';
import { LoginForm } from '../../features/auth/ui/LoginForm';
import type { LoginCredentials } from '../../features/auth/ui/LoginForm';
import { useSessionStore } from '../../shared/session/session-store';
import { WelcomePage } from '../welcome/WelcomePage';

/**
 * Demo hesaplar yalnizca gelistirme paketinde (vite.config.ts): kosul derleme
 * aninda "false" olunca liste ve persona verisi pakete hic girmez.
 */
const renderDemo = __DEMO_PERSONAS__
  ? (fill: (credentials: LoginCredentials) => void) => <DemoPersonaPicker onPick={fill} />
  : undefined;

/**
 * Karsilama kartindaki demo hesaplardan acilinca sifre (gecmis durumu yalnizca
 * "demo" isaretini tasir, sifreyi degil). Production'da bos: kosul derleme
 * aninda "false" olunca persona dosyasi pakete girmez.
 */
const DEMO_INITIAL_PASSWORD = __DEMO_PERSONAS__ ? DEMO_PASSWORD : '';

/**
 * /giris (T8.5; T11.6'dan beri karsilama ekraninin ustunde pencere): telefon +
 * sifre. Karsilama kartindan ya da kayit penceresinden gelen numara dolu
 * gelir. Oturum acilinca (ya da zaten aciksa) donus adresine gidilir; adres
 * yalnizca uygulama icindeki bir yol olabilir (next-path.ts).
 */
export function LoginPage() {
  const status = useSessionStore((state) => state.status);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const next = safeNextPath(searchParams.get(NEXT_PARAM));
  const { phoneEntry, fromApp, demo } = readAuthRouteState(location.state);
  const [entry, setEntry] = useState<PhoneEntry | null>(phoneEntry);
  const close = useCloseAuthDialog(fromApp);

  if (status === 'authenticated') {
    return <Navigate to={next} replace />;
  }
  // Alt bant ve kayitsiz numara uyarisi ayni yere, numarayla gider.
  const registerSwitch = {
    to: withNextPath(AUTH_ROUTES.register, next),
    state: { phoneEntry: entry ?? undefined, fromApp },
  };
  // "Sifremi unuttum" (T11.9) yalnizca gelistirme paketinde; numarayla gider.
  const forgotPassword = __DEMO_PASSWORD_RESET__
    ? {
        to: withNextPath(AUTH_ROUTES.forgotPassword, next),
        state: { phoneEntry: entry ?? undefined, fromApp },
      }
    : undefined;
  return (
    <WelcomePage
      renderDialog={(content) => (
        <AuthDialog
          title={content.header.loginLabel}
          closeLabel={content.loginCard.closeLabel}
          onClose={close}
          footer={
            <AuthSwitch
              prompt={content.loginCard.login.registerPrompt}
              label={content.loginCard.login.registerLinkLabel}
              to={registerSwitch.to}
              state={registerSwitch.state}
            />
          }
        >
          <LoginForm
            content={content.loginCard}
            initialEntry={phoneEntry}
            initialPassword={demo ? DEMO_INITIAL_PASSWORD : ''}
            onPhoneChange={setEntry}
            registerSwitch={registerSwitch}
            forgotPassword={forgotPassword}
            renderPrefill={renderDemo}
          />
        </AuthDialog>
      )}
    />
  );
}

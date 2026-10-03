import type { WelcomeContent } from '@getir/contracts';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { DemoPersonaPicker } from '../../features/auth/demo/DemoPersonaPicker';
import { AUTH_ROUTES } from '../../features/auth/routes';
import type { AuthRouteState, PhoneEntry } from '../../features/auth/services/auth-route-state';
import { countryOfPhone } from '../../features/auth/services/country';
import { AuthCard } from '../../features/auth/ui/AuthCard';
import { AuthCardLinks } from '../../features/auth/ui/AuthCardLinks';
import { AuthSwitch } from '../../features/auth/ui/AuthSwitch';
import { ForgotPasswordLink } from '../../features/auth/ui/ForgotPasswordLink';
import type { LoginCredentials } from '../../features/auth/ui/LoginForm';
import { PhoneEntryForm } from '../../features/auth/ui/PhoneEntryForm';

import { WelcomeAppDownload } from './WelcomeAppDownload';
import { WelcomeCategories } from './WelcomeCategories';
import { WelcomeContentGate } from './WelcomeContentGate';
import { WelcomeFeatures } from './WelcomeFeatures';
import { WelcomeHeader } from './WelcomeHeader';
import { WelcomeHero } from './WelcomeHero';

/** Karsilama ekranindan acilan pencere: kapatinca bir geri gidilir (useCloseAuthDialog). */
const FROM_APP: AuthRouteState = { fromApp: true };

/**
 * Demo hesaplar yalnizca gelistirme paketinde (vite.config.ts): kosul derleme
 * aninda "false" olunca liste ve persona verisi pakete hic girmez.
 */
const renderDemo = __DEMO_PERSONAS__
  ? (pick: (credentials: LoginCredentials) => void) => <DemoPersonaPicker onPick={pick} floating />
  : undefined;

interface WelcomePageProps {
  /** Ekranin ustunde acilan pencere (giris ya da kayit; /giris, /kayit). */
  readonly renderDialog?: ((content: WelcomeContent) => ReactNode) | undefined;
}

/**
 * Karsilama ekrani (T11.6; kullanicinin PRD'si): oturumsuz ziyaretcinin ana
 * sayfasi. Ust bar, banner + telefon karti, kategoriler, uygulama indirme
 * bandi ve tanitim kutulari (T11.7). Butun metin ve
 * gorseller icerik ucundan gelir (GET /v1/content/welcome).
 *
 * Giris ve kayit bu ekranin USTUNDE pencere olarak acilir (/giris, /kayit):
 * kartta "Devam Et" numarayla giris penceresini, altindaki "Sifremi unuttum"
 * (T11.9, yalnizca gelistirmede) sifre yenileme penceresini, "Kayit ol"
 * (yazilan numarayla) kayit penceresini acar; kategoriler ve ust bar da
 * pencereleri acar. Gelistirmede kartin altindaki demo hesaplar giris
 * penceresini telefon ve sifre dolu acar. Numara adrese yazilmaz, gecmis
 * durumunda tasinir (auth-route-state.ts).
 */
export function WelcomePage({ renderDialog }: WelcomePageProps) {
  const navigate = useNavigate();
  const [entry, setEntry] = useState<PhoneEntry | null>(null);
  const openLogin = (): void => navigate(AUTH_ROUTES.login, { state: FROM_APP });

  return (
    <WelcomeContentGate>
      {(content) => {
        const openLoginAsDemo = (credentials: LoginCredentials): void => {
          const country = countryOfPhone(content.loginCard.countries, credentials.phone);
          const phoneEntry =
            country === undefined
              ? undefined
              : {
                  dialCode: country.dialCode,
                  digits: credentials.phone.slice(country.dialCode.length),
                };
          navigate(AUTH_ROUTES.login, { state: { ...FROM_APP, phoneEntry, demo: true } });
        };
        return (
          <>
            <WelcomeHeader header={content.header} linkState={FROM_APP} />
            <main>
              <WelcomeHero hero={content.hero}>
                <AuthCard title={content.loginCard.title} headingLevel={2}>
                  <PhoneEntryForm
                    content={content.loginCard}
                    onPhoneChange={setEntry}
                    onAccepted={(accepted) =>
                      navigate(AUTH_ROUTES.login, { state: { ...FROM_APP, phoneEntry: accepted } })
                    }
                  />
                  <AuthCardLinks>
                    {__DEMO_PASSWORD_RESET__ && (
                      <ForgotPasswordLink
                        label={content.loginCard.forgotPasswordLabel}
                        target={{
                          to: AUTH_ROUTES.forgotPassword,
                          state: { ...FROM_APP, phoneEntry: entry ?? undefined },
                        }}
                        align="center"
                        replace={false}
                      />
                    )}
                    <AuthSwitch
                      prompt={content.loginCard.login.registerPrompt}
                      label={content.loginCard.login.registerLinkLabel}
                      to={AUTH_ROUTES.register}
                      state={{ ...FROM_APP, phoneEntry: entry ?? undefined }}
                      replace={false}
                    />
                  </AuthCardLinks>
                  {renderDemo?.(openLoginAsDemo)}
                </AuthCard>
              </WelcomeHero>
              <WelcomeCategories title={content.categories.title} onSelect={openLogin} />
              <WelcomeAppDownload content={content.appDownload} />
              <WelcomeFeatures features={content.features} />
            </main>
            {renderDialog?.(content)}
          </>
        );
      }}
    </WelcomeContentGate>
  );
}

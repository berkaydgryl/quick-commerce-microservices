import { CONTENT_FALLBACK } from '@getir/contracts';
import { useLocation } from 'react-router-dom';

import { HeaderAddressPicker } from '../features/address/ui/HeaderAddressPicker';
import { loginPathFor } from '../features/auth/services/next-path';
import { HeaderAccount } from '../features/auth/ui/HeaderAccount';
import type { HeaderAccountTexts } from '../features/auth/ui/HeaderAccount';
import { useWelcomeContent } from '../features/content/hooks/useWelcomeContent';
import { FAVORITES_PATH } from '../features/favorites/routes';
import {
  HeaderSearch,
  HeaderSearchFallback,
  HeaderSearchPlaceholder,
} from '../features/search/ui/HeaderSearch';
import { useSessionStore } from '../shared/session/session-store';
import { Logo } from '../shared/ui/logo/Logo';

import { headerSearchHref } from './header-search-href';

/**
 * Ust barin yuvalari (T11.10): ozellikleri burada birlestirir. Arama kutusu
 * (search) teslimat adresini (address) ve giris yolunu (auth) tanimaz; adres
 * giris yolunu tanimaz. Metinler icerik ucundan; icerik gelene kadar ayni
 * boyda yer tutucu.
 *
 * Icerik ucu hata verirse (T11.10 duzeltmesi) bar calismaya devam eder: logo
 * ve hesap alani icerik yedegiyle (@getir/contracts CONTENT_FALLBACK; degerler
 * welcome.json ile ayni) gelir, arama kutusunun yerinde mesaj ve "Tekrar dene".
 * Oturumdaki kullanici her durumda cikis yapabilir ve Hesabim'a gidebilir.
 */

export function AppHeaderLogo() {
  const { data: content, error } = useWelcomeContent();
  if (content !== undefined) {
    return <Logo brand={content.header.brand} service={content.header.service} tone="inverse" />;
  }
  if (error !== null) {
    return (
      <Logo brand={CONTENT_FALLBACK.brand} service={CONTENT_FALLBACK.service} tone="inverse" />
    );
  }
  return null;
}

export function AppHeaderSearch() {
  const { data: content, error, refetch } = useWelcomeContent();
  const session = useSessionStore((state) => state.status);
  const loginHref = loginPathFor(useLocation());
  if (content === undefined) {
    return error === null ? (
      <HeaderSearchPlaceholder />
    ) : (
      <HeaderSearchFallback
        message={error.message}
        retryLabel={CONTENT_FALLBACK.retryLabel}
        onRetry={() => void refetch()}
      />
    );
  }
  return (
    <HeaderSearch
      content={content.appHeader}
      resultsHref={(query) => headerSearchHref(session, query)}
      address={
        <HeaderAddressPicker
          content={content.appHeader}
          setup={content.addressSetup}
          closeLabel={content.loginCard.closeLabel}
          loginHref={loginHref}
        />
      }
    />
  );
}

export function AppHeaderAccount() {
  const { data: content, error } = useWelcomeContent();
  return <HeaderAccount texts={accountTexts(content, error)} favoritesHref={FAVORITES_PATH} />;
}

function accountTexts(
  content: ReturnType<typeof useWelcomeContent>['data'],
  error: Error | null,
): HeaderAccountTexts | undefined {
  if (content !== undefined) {
    return { ...content.appHeader, loginLabel: content.header.loginLabel };
  }
  return error === null ? undefined : CONTENT_FALLBACK;
}

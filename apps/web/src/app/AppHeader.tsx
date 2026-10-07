import { CONTENT_FALLBACK } from '@getir/contracts';
import { useLocation } from 'react-router-dom';

import { HeaderAddressPicker } from '../features/address/ui/HeaderAddressPicker';
import { loginPathFor } from '../features/auth/services/next-path';
import { HeaderAccount } from '../features/auth/ui/HeaderAccount';
import type { HeaderAccountTexts } from '../features/auth/ui/HeaderAccount';
import { useAccountMenuContent } from '../features/content/hooks/useAccountMenuContent';
import { useAppHeaderContent } from '../features/content/hooks/useAppHeaderContent';
import { contentFailed, useWelcomeContent } from '../features/content/hooks/useWelcomeContent';
import { HeaderSearch, HeaderSearchPlaceholder } from '../features/search/ui/HeaderSearch';
import { accountMenuLinks } from '../pages/account/account-menu';
import { useSessionStore } from '../shared/session/session-store';
import { Logo } from '../shared/ui/logo/Logo';

import { headerSearchHref } from './header-search-href';

/**
 * Ust barin yuvalari (T11.10): ozellikleri burada birlestirir. Arama kutusu
 * (search) teslimat adresini (address) ve giris yolunu (auth) tanimaz; adres
 * giris yolunu tanimaz. Metinler icerik ucundan; icerik gelene kadar ayni
 * boyda yer tutucu.
 *
 * Icerik ucu hata verirse ya da gateway ile web arasindaki surum farki
 * yuzunden sema gecmezse bar AYNEN calisir (F21; 07.10 hatasi): logo, arama
 * kutusu, adres dugmesi ve penceresi, hesap alani icerik yedegiyle
 * (@getir/contracts CONTENT_FALLBACK; degerler welcome.json ile ayni). Barda
 * hata mesaji yok; oturumdaki kullanici her durumda cikis yapabilir.
 */

export function AppHeaderLogo() {
  const query = useWelcomeContent();
  const content = query.data;
  if (content !== undefined) {
    return <Logo brand={content.header.brand} service={content.header.service} tone="inverse" />;
  }
  if (contentFailed(query)) {
    return (
      <Logo brand={CONTENT_FALLBACK.brand} service={CONTENT_FALLBACK.service} tone="inverse" />
    );
  }
  return null;
}

export function AppHeaderSearch() {
  const texts = useAppHeaderContent();
  const session = useSessionStore((state) => state.status);
  const loginHref = loginPathFor(useLocation());
  if (texts === undefined) {
    return <HeaderSearchPlaceholder />;
  }
  return (
    <HeaderSearch
      content={texts.appHeader}
      resultsHref={(query) => headerSearchHref(session, query)}
      address={
        <HeaderAddressPicker
          content={texts.appHeader}
          setup={texts.addressSetup}
          closeLabel={texts.closeLabel}
          loginHref={loginHref}
        />
      }
    />
  );
}

/**
 * Sade barin teslimat adresi (T16.3; sepet ve odeme): aramadaki adres
 * dugmesinin AYNISI, tek basina. Icerik gelene kadar yer yok; icerik hatasinda
 * yedekle (F21).
 */
export function AppHeaderAddress() {
  const texts = useAppHeaderContent();
  const loginHref = loginPathFor(useLocation());
  if (texts === undefined) {
    return null;
  }
  return (
    <HeaderAddressPicker
      content={texts.appHeader}
      setup={texts.addressSetup}
      closeLabel={texts.closeLabel}
      loginHref={loginHref}
    />
  );
}

/**
 * Profil menusu: maddeler hesap sayfalarinin sol menusuyle AYNI listeden
 * (T11.16, accountMenuItems); burada yalnizca baglanir.
 */
export function AppHeaderAccount() {
  const query = useWelcomeContent();
  const menu = useAccountMenuContent();
  return (
    <HeaderAccount
      texts={accountTexts(query.data, contentFailed(query))}
      menu={menu === undefined ? undefined : accountMenuLinks(menu)}
    />
  );
}

function accountTexts(
  content: ReturnType<typeof useWelcomeContent>['data'],
  failed: boolean,
): HeaderAccountTexts | undefined {
  if (content !== undefined) {
    return { ...content.appHeader, loginLabel: content.header.loginLabel };
  }
  return failed ? CONTENT_FALLBACK : undefined;
}

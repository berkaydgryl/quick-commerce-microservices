import { useLocation } from 'react-router-dom';

import { HeaderAddressPicker } from '../features/address/ui/HeaderAddressPicker';
import { loginPathFor } from '../features/auth/services/next-path';
import { HeaderAccount } from '../features/auth/ui/HeaderAccount';
import { useWelcomeContent } from '../features/content/hooks/useWelcomeContent';
import { HeaderSearch, HeaderSearchPlaceholder } from '../features/search/ui/HeaderSearch';

/**
 * Ust barin yuvalari (T11.10): ozellikleri burada birlestirir. Arama kutusu
 * (search) teslimat adresini (address) tanimaz; adres giris yolunu (auth)
 * tanimaz. Metinler icerik ucundan (appHeader); icerik gelene kadar ayni boyda
 * yer tutucu.
 */
export function AppHeaderSearch() {
  const { data: content } = useWelcomeContent();
  const loginHref = loginPathFor(useLocation());
  if (content === undefined) {
    return <HeaderSearchPlaceholder />;
  }
  return (
    <HeaderSearch
      content={content.appHeader}
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
  const { data: content } = useWelcomeContent();
  return <HeaderAccount content={content?.appHeader} loginLabel={content?.header.loginLabel} />;
}

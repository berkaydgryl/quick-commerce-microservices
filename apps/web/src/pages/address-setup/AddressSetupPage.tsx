import { AddressSetupDialog } from '../../features/address/ui/AddressSetupDialog';
import { useLogout } from '../../features/auth/hooks/useLogout';
import { useHeaderSlots } from '../../shared/ui/page-layout/header-slot';
import { WelcomePage } from '../welcome/WelcomePage';

interface AddressSetupPageProps {
  readonly userId: string;
}

/**
 * Adres ekleme ekrani (T11.8): oturum acik ama kayitli adres yoksa "/" bunu
 * gosterir (RootPage). Karsilama ekraninin USTUNDE adres penceresi (giris
 * penceresi gibi). Pencereyi kapatmak cikistir: sayfa karsilama ekranina
 * yeniden yuklenir. Kaydedince defter dolar ve "/" market listesine gecer.
 * Ust barda "Giriş yap / Kayıt ol" yerine Profil (07.10 kullanici istegi:
 * Profil her sayfada); pencere modal oldugu icin acikken bar etkisizdir,
 * cikis pencereyi kapatmaktir.
 */
export function AddressSetupPage({ userId }: AddressSetupPageProps) {
  const logout = useLogout();
  const { account } = useHeaderSlots();
  return (
    <WelcomePage
      headerAccount={account}
      renderDialog={(content) => (
        <AddressSetupDialog
          content={content.addressSetup}
          closeLabel={content.loginCard.closeLabel}
          userId={userId}
          onClose={() => logout.mutate()}
          closing={logout.isPending}
          closeError={logout.error?.message ?? null}
        />
      )}
    />
  );
}

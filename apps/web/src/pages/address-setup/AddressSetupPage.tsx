import { AddressSetupDialog } from '../../features/address/ui/AddressSetupDialog';
import { useLogout } from '../../features/auth/hooks/useLogout';
import { WelcomePage } from '../welcome/WelcomePage';

interface AddressSetupPageProps {
  readonly userId: string;
}

/**
 * Adres ekleme ekrani (T11.8): oturum acik ama kayitli adres yoksa "/" bunu
 * gosterir (RootPage). Karsilama ekraninin USTUNDE adres penceresi (giris
 * penceresi gibi). Pencereyi kapatmak cikistir: sayfa karsilama ekranina
 * yeniden yuklenir. Kaydedince defter dolar ve "/" market listesine gecer.
 */
export function AddressSetupPage({ userId }: AddressSetupPageProps) {
  const logout = useLogout();
  return (
    <WelcomePage
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

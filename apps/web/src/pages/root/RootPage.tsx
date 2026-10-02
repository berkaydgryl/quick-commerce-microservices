import { useSavedAddresses } from '../../features/address/hooks/useSavedAddresses';
import { rootView } from '../../features/address/services/address-gate';
import { addressBookState } from '../../features/address/services/delivery-address';
import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
import { useSessionStore } from '../../shared/session/session-store';
import { AddressSetupPage } from '../address-setup/AddressSetupPage';
import { HomePage } from '../home/HomePage';
import { WelcomePage } from '../welcome/WelcomePage';

/**
 * "/" kapisi (T11.6, T11.8): oturumsuz ziyaretci karsilama ekranini, kayitli
 * adresi olmayan kullanici adres ekleme penceresini, adresi olan kullanici
 * ana sayfayi (market listesi) gorur. Karar address-gate.ts'te.
 *
 * Karsilama icerigi yalnizca gerekince istenir: oturum belli olmadan
 * (acilistaki sessiz yenilemeyle paralel) ve adres eklenecekken.
 */
export function RootPage() {
  const status = useSessionStore((state) => state.status);
  const userId = useSessionStore((state) => state.user?.id ?? null);
  const view = rootView(status, addressBookState(useSavedAddresses(userId)));
  useWelcomeContent(status !== 'authenticated' || view === 'address-setup');

  switch (view) {
    case 'wait':
      return null;
    case 'welcome':
      return <WelcomePage />;
    case 'address-setup':
      return userId === null ? null : <AddressSetupPage userId={userId} />;
    case 'home':
      return <HomePage />;
  }
}

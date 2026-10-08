import { Outlet } from 'react-router-dom';

import { AddressChangeGuardProvider } from '../features/cart/ui/AddressChangeGuardProvider';
import { HeaderSlotContext } from '../shared/ui/page-layout/header-slot';
import type { HeaderSlots } from '../shared/ui/page-layout/header-slot';

import { AppHeaderAccount, AppHeaderAddress, AppHeaderLogo, AppHeaderSearch } from './AppHeader';
import { AppToaster } from './AppToaster';

/** Yuvalar bir kez kurulur: her yonlendirmede tuketicileri bosuna cizilmez. */
const HEADER_SLOTS: HeaderSlots = {
  logo: <AppHeaderLogo />,
  search: <AppHeaderSearch />,
  account: <AppHeaderAccount />,
  address: <AppHeaderAddress />,
};

/**
 * Butun rotalarin kabugu (T8.5; T11.10): ust barin yuvalarini doldurur.
 * T11.13'ten beri uygulamanin tek bildirim alani da buradadir. F16'dan beri
 * adres degisiminin bekcisi (sepetin marketi yeni adrese teslim ediyor mu).
 */
export function AppShell() {
  return (
    <HeaderSlotContext.Provider value={HEADER_SLOTS}>
      <AddressChangeGuardProvider>
        <Outlet />
      </AddressChangeGuardProvider>
      <AppToaster />
    </HeaderSlotContext.Provider>
  );
}

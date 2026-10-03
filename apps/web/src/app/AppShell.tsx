import { Outlet } from 'react-router-dom';

import { HeaderSlotContext } from '../shared/ui/page-layout/header-slot';
import type { HeaderSlots } from '../shared/ui/page-layout/header-slot';

import { AppHeaderAccount, AppHeaderLogo, AppHeaderSearch } from './AppHeader';

/** Yuvalar bir kez kurulur: her yonlendirmede tuketicileri bosuna cizilmez. */
const HEADER_SLOTS: HeaderSlots = {
  logo: <AppHeaderLogo />,
  search: <AppHeaderSearch />,
  account: <AppHeaderAccount />,
};

/** Butun rotalarin kabugu (T8.5; T11.10): ust barin yuvalarini doldurur. */
export function AppShell() {
  return (
    <HeaderSlotContext.Provider value={HEADER_SLOTS}>
      <Outlet />
    </HeaderSlotContext.Provider>
  );
}

import { Outlet } from 'react-router-dom';

import { HeaderAccount } from '../features/auth/ui/HeaderAccount';
import { HeaderSlotContext } from '../shared/ui/page-layout/header-slot';

/** Eleman bir kez kurulur: her yonlendirmede yuvanin tuketicileri bosuna cizilmez. */
const HEADER_ACCOUNT = <HeaderAccount />;

/** Butun rotalarin kabugu (T8.5): basligin yuvasina hesap baglantisini koyar. */
export function AppShell() {
  return (
    <HeaderSlotContext.Provider value={HEADER_ACCOUNT}>
      <Outlet />
    </HeaderSlotContext.Provider>
  );
}

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Basligin yuvalari (T8.5; T11.10'dan beri iki yuva). Uygulama katmani
 * doldurur (app/AppShell.tsx); paylasilan duzen ozellikleri tanimaz.
 */
export interface HeaderSlots {
  /** Logo (metni icerikten; T11.10 duzeltmesi). */
  readonly logo: ReactNode;
  /** Ortadaki arama kutusu (icinde teslimat adresi; T11.10). */
  readonly search: ReactNode;
  /** Sagdaki hesap alani (Profil ya da Giris yap). */
  readonly account: ReactNode;
}

const EMPTY: HeaderSlots = { logo: null, search: null, account: null };

export const HeaderSlotContext = createContext<HeaderSlots>(EMPTY);

export function useHeaderSlots(): HeaderSlots {
  return useContext(HeaderSlotContext);
}

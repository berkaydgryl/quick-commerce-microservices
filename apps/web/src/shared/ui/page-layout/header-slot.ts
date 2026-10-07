import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Basligin yuvalari (T8.5; T11.10'dan beri iki yuva, T16.3'te sade barin
 * adres yuvasi). Uygulama katmani doldurur (app/AppShell.tsx); paylasilan
 * duzen ozellikleri tanimaz.
 */
export interface HeaderSlots {
  /** Logo (metni icerikten; T11.10 duzeltmesi). */
  readonly logo: ReactNode;
  /** Ortadaki arama kutusu (icinde teslimat adresi; T11.10). */
  readonly search: ReactNode;
  /** Sagdaki hesap alani (Profil ya da Giris yap). */
  readonly account: ReactNode;
  /** Sade barda (sepet ve odeme, T16.3) aramanin yerine tek basina teslimat adresi. */
  readonly address: ReactNode;
}

const EMPTY: HeaderSlots = { logo: null, search: null, account: null, address: null };

export const HeaderSlotContext = createContext<HeaderSlots>(EMPTY);

export function useHeaderSlots(): HeaderSlots {
  return useContext(HeaderSlotContext);
}

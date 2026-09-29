import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Basligin sag ucundaki yuva (T8.5). Uygulama katmani doldurur (hesap
 * baglantisi, app/AppShell.tsx); paylasilan duzen ozellikleri tanimaz.
 */
export const HeaderSlotContext = createContext<ReactNode>(null);

export function useHeaderSlot(): ReactNode {
  return useContext(HeaderSlotContext);
}

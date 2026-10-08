import type { GeoPoint } from '@getir/contracts';
import { createContext, useContext } from 'react';

/**
 * Bekcinin izni (F16): adres GERCEKTEN degisince (secim yapildi, kayit basarili)
 * cagiran commit() der. Sepet "Evet"te degil commit'te bosalir: kayit duserse
 * sepet kalir.
 */
export interface AddressChangeApproval {
  readonly commit: () => void;
}

/** Sepete dokunmayan izin: sepet bos, market yeni adrese teslim ediyor ya da adres ayni. */
export const KEEP_CART: AddressChangeApproval = { commit: () => undefined };

/**
 * Teslimat adresi degismeden once sorulan bekci (F16): izin ya da null (adres
 * degismez). Adres ozelligi sepeti tanimaz; kurali sepet katmani saglar,
 * uygulama baglar (AppShell). Saglayici yoksa (test, karsilama) sorulmaz.
 */
export type AddressChangeGuard = (location: GeoPoint) => Promise<AddressChangeApproval | null>;

const allow: AddressChangeGuard = () => Promise.resolve(KEEP_CART);

export const AddressChangeGuardContext = createContext<AddressChangeGuard>(allow);

export function useAddressChangeGuard(): AddressChangeGuard {
  return useContext(AddressChangeGuardContext);
}

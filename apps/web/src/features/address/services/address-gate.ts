/**
 * "/" kapisinin karari (T11.8): SAF kural. Hangi ekran: karsilama, adres
 * ekleme, ana sayfa ya da (oturum ve defter belli olana kadar) hicbiri.
 *
 *  - Oturum belli degilse ya da defter ilk kez okunuyorsa BEKLENIR: adresi
 *    olan kullanici adres penceresini, oturumu acik kullanici karsilamayi bir
 *    an gormesin.
 *  - Oturumsuz ziyaretci karsilama ekranini gorur.
 *  - Oturumdaki kullanicinin defteri BOSSA adres eklenir (yeni kayit da,
 *    adressiz eski hesap da).
 *  - Defter okunamazsa ana sayfa acilir (varsayilan adresle): uygulama defter
 *    yuzunden kilitlenmez.
 */

import type { SavedAddress } from '@getir/contracts';

import type { SessionStatus } from '../../../shared/session/session-store';

import type { DeliveryInputs } from './delivery-address';

export type RootView = 'wait' | 'welcome' | 'address-setup' | 'home';

export function rootView(session: SessionStatus, addresses: DeliveryInputs['addresses']): RootView {
  switch (session) {
    case 'unknown':
      return 'wait';
    case 'anonymous':
      return 'welcome';
    case 'authenticated':
      return accountView(addresses);
  }
}

function accountView(addresses: 'loading' | 'error' | readonly SavedAddress[]): RootView {
  if (addresses === 'loading') {
    return 'wait';
  }
  if (addresses === 'error') {
    return 'home';
  }
  return addresses.length === 0 ? 'address-setup' : 'home';
}

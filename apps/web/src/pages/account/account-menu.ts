/**
 * Hesap menusunun TEK listesi (T11.16; kullanici istegi): profil sayfasinin
 * sol menusu (AccountMenu) ve ust barin Profil acilir menusu (AppHeader) yalnizca
 * buradan cizilir; ikisi ayni maddeleri ayni sirayla gosterir (testli). Madde
 * eklemek = buraya satir + icerige etiket (T11.17 Ödeme Yöntemlerim boyle geldi).
 */

import type { AccountMenuContent } from '@getir/contracts';

import { ADDRESSES_PATH } from '../../features/address/routes';
import { AUTH_ROUTES } from '../../features/auth/routes';
import { PAYMENT_METHODS_PATH } from '../../features/cards/routes';
import { FAVORITES_PATH } from '../../features/favorites/routes';
import { ORDERS_PATH } from '../../features/orders/routes';

/** Maddenin etiketi icerikte hangi anahtarda (menunun adi haric). */
type AccountMenuLabelKey = Exclude<keyof AccountMenuContent, 'label'>;

interface AccountMenuItem {
  readonly href: string;
  readonly labelKey: AccountMenuLabelKey;
  /**
   * Yalnizca tam adreste secili: /hesabim alt sekmelerin de onekidir; Profilim
   * yalnizca /hesabim'de secili gorunur. Digerleri alt adreslerinde de secili
   * (siparis detayi Gecmis Siparislerim'i secer).
   */
  readonly end: boolean;
}

export const accountMenuItems: readonly AccountMenuItem[] = [
  { href: AUTH_ROUTES.account, labelKey: 'profileLabel', end: true },
  { href: ADDRESSES_PATH, labelKey: 'addressesLabel', end: false },
  { href: FAVORITES_PATH, labelKey: 'favoritesLabel', end: false },
  { href: ORDERS_PATH, labelKey: 'ordersLabel', end: false },
  // T11.17: Gecmis Siparislerim'in altinda ayri madde; kart ekleme alt adresinde de secili.
  // Production paketinde yok (__CARD_VAULT__, K1 (a)): kart uclari orada kapali.
  ...(__CARD_VAULT__
    ? [{ href: PAYMENT_METHODS_PATH, labelKey: 'paymentMethodsLabel', end: false } as const]
    : []),
];

/** Cizilecek baglanti: adres, icerikten etiket ve secilme kurali. */
export interface AccountMenuLink {
  readonly href: string;
  readonly label: string;
  readonly end: boolean;
}

/** Listenin maddeleri, sirasiyla, etiketleri icerikten. */
export function accountMenuLinks(texts: AccountMenuContent): readonly AccountMenuLink[] {
  return accountMenuItems.map((item) => ({
    href: item.href,
    label: texts[item.labelKey],
    end: item.end,
  }));
}

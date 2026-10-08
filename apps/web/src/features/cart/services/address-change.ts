/**
 * Adres degisince sepetin marketi (F16; kural TEK yerde): bos sepet ya da
 * yeni konuma teslim eden marketler arasinda sepetin marketi varsa adres
 * hemen degisir; yoksa onay sorulur ("sepet bosaltilacak"). Yakin marketler
 * okunamazsa adres DEGISIR (sunucu rezervasyonda kapsamayi zaten denetler)
 * ve uyari gunluge duser.
 *
 * Bagimlilik (#175): kapsama ListNearbyMarkets'in cevabidir. Katalogun aday
 * siniri kapsama filtresinden once uygulanirsa kapsayan market listede
 * olmayabilir; duzeltme catalog'da, bu kural degismez.
 */

import { KEEP_CART } from '../../../shared/address-change/guard';
import type { AddressChangeApproval } from '../../../shared/address-change/guard';

export type AddressChangeVerdict = 'proceed' | 'ask' | 'unverified';

interface CartSnapshot {
  readonly cartMarketId: string | null;
  readonly cartCount: number;
}

function cartIsEmpty({ cartMarketId, cartCount }: CartSnapshot): boolean {
  return cartMarketId === null || cartCount === 0;
}

export function addressChangeVerdict(
  input: CartSnapshot & {
    /** Yeni konuma teslim eden marketler; okunamadiysa 'error'. */
    readonly nearby: readonly { readonly id: string }[] | 'error';
  },
): AddressChangeVerdict {
  if (cartIsEmpty(input)) {
    return 'proceed';
  }
  if (input.nearby === 'error') {
    return 'unverified';
  }
  return input.nearby.some((market) => market.id === input.cartMarketId) ? 'proceed' : 'ask';
}

interface CheckInput extends CartSnapshot {
  readonly readNearby: () => Promise<readonly { readonly id: string }[]>;
  readonly onCheckFailed: (error: unknown) => void;
}

/**
 * Kontrolun tamami (saf; disaridan verilen okumayla): sepet bossa okuma
 * yapilmaz; okuma dusarse karar 'unverified' ve hata bildirilir (gunluk).
 */
export async function checkAddressChange(input: CheckInput): Promise<AddressChangeVerdict> {
  if (cartIsEmpty(input)) {
    return addressChangeVerdict({ ...input, nearby: [] });
  }
  try {
    return addressChangeVerdict({ ...input, nearby: await input.readNearby() });
  } catch (error) {
    input.onCheckFailed(error);
    return addressChangeVerdict({ ...input, nearby: 'error' });
  }
}

/**
 * Bekcinin karari (saf): izin ya da null (adres degismez).
 *  - Okuma surerken yeni bir degisim baslarsa (isLatest false) bu degisim
 *    duser: kullanicinin SON secimi gecerli.
 *  - Sorulursa "Hayır" null; "Evet" izni sepeti commit'te bosaltir (adres
 *    gercekten degisince), "Evet" aninda degil. clearCart yeni konuma teslim
 *    eden marketleri alir (kalinan market sayfasi icin, leavesStorePage).
 */
export async function approveAddressChange(
  input: CheckInput & {
    readonly isLatest: () => boolean;
    readonly ask: () => Promise<boolean>;
    readonly clearCart: (serving: readonly string[]) => void;
  },
): Promise<AddressChangeApproval | null> {
  let serving: readonly string[] = [];
  const verdict = await checkAddressChange({
    ...input,
    readNearby: async () => {
      const nearby = await input.readNearby();
      serving = nearby.map((market) => market.id);
      return nearby;
    },
  });
  if (!input.isLatest()) {
    return null;
  }
  if (verdict !== 'ask') {
    return KEEP_CART;
  }
  return (await input.ask()) ? { commit: () => input.clearCart(serving) } : null;
}

/**
 * "Evet"ten sonra kalinan sayfa (PM 08.10): kullanici yeni adrese teslim
 * etmeyen bir marketin sayfasindaysa market listesine gider (sayfa "Açık"
 * deyip urun ekletmesin); baska sayfalarda kalir.
 */
export function leavesStorePage(storeId: string | undefined, serving: readonly string[]): boolean {
  return storeId !== undefined && !serving.includes(storeId);
}

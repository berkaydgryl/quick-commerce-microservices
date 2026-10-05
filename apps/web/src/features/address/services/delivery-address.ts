/**
 * Hangi teslimat adresi gecerli (T9.5): SAF kural. Ana sayfanin aramasi ve
 * market listesi, /markets sayfasi bu adresin konumuyla sorar.
 *
 *  - Oturum henuz bilinmiyorsa (acilistaki sessiz yenileme) ya da adres
 *    defteri yukleniyorsa BEKLENIR: konuma bagli istek once yanlis konuma
 *    (varsayilana) gidip sonra degismesin.
 *  - Oturumsuz ziyaretci, adresi olmayan hesap ve defteri okunamayan oturum
 *    VARSAYILAN adresi ("Ev") kullanir; arayuz nedenini gosterebilsin diye
 *    neden de tasinir.
 *  - Oturumdaki kullanicinin secimi, KENDI defterinde o kimlikte adres varsa
 *    gecerlidir; yoksa (secim yok, baska hesabin secimi, adres silinmis)
 *    defterin ILK adresi (T11.15, K6: secili adres silinince de bu kural).
 *    Adres kimligiyle taninir (T11.15); surum 1'den tasinmis secim adla
 *    eslesir, kimlige cevrilene kadar (address-selection.ts).
 */

import type { GeoPoint, SavedAddress } from '@getir/contracts';

import type { SessionStatus } from '../../../shared/session/session-store';
import { DEFAULT_ADDRESS_TITLE, DEFAULT_DELIVERY_LOCATION } from '../constants';

import { findSelected } from './address-selection';
import type { StoredSelection } from './address-selection';

/** Varsayilan adresin nedeni: oturum yok, hesapta adres yok, defter okunamadi. */
export type DefaultReason = 'anonymous' | 'no-addresses' | 'unavailable';

/**
 * Cozulmus teslimat adresi. Sozlesmedeki DeliveryAddress'ten (rezervasyonun
 * { line, location } govdesi) AYRI: burada bekleme ve varsayilan da var.
 */
export type DeliveryAddressState =
  | { readonly status: 'pending' }
  | {
      readonly status: 'ready';
      readonly source: 'account';
      /** Gecerli adresin kimligi: secici ve Adreslerim'in "secili" isareti. */
      readonly addressId: string;
      readonly title: string;
      readonly location: GeoPoint;
    }
  | {
      readonly status: 'ready';
      readonly source: 'default';
      readonly reason: DefaultReason;
      readonly title: string;
      readonly location: GeoPoint;
    };

export interface DeliveryInputs {
  readonly session: SessionStatus;
  /** Oturumdaki kullanici; oturum yoksa null. */
  readonly userId: string | null;
  /** Adres defteri: yukleniyor, okunamadi ya da liste. */
  readonly addresses: 'loading' | 'error' | readonly SavedAddress[];
  readonly selection: StoredSelection | null;
}

/** Defter sorgusunun resolveDeliveryAddress'e giden kismi (TanStack Query sonucu). */
export interface AddressBookQuery {
  readonly data: readonly SavedAddress[] | undefined;
  readonly isError: boolean;
  /** Sorgunun simdiye kadar kac kez hatayla bittigi; yeni denemede sifirlanmaz. */
  readonly errorUpdateCount: number;
}

/**
 * Defterin durumu:
 *  - veri varsa o: yenileme hatasi eski listeyi silmez, secim ve konum kalir;
 *  - veri yok ama hata alinmis: okunamadi. Hatadan sonraki yeniden deneme
 *    ("Tekrar dene", sekme odagi) sirasinda TanStack, veri olmadigi icin durumu
 *    yeniden "pending"e ceker ve hatayi siler. Bu "yukleniyor" sayilsaydi konum
 *    kalkar, bolumler "yukleniyor"a doner ve hata gelince geri gelirdi;
 *  - hic hata alinmadiysa yukleniyor: ilk okuma bitmeden konuma istek gitmez.
 */
export function addressBookState(query: AddressBookQuery): DeliveryInputs['addresses'] {
  if (query.data !== undefined) {
    return query.data;
  }
  return query.isError || query.errorUpdateCount > 0 ? 'error' : 'loading';
}

/**
 * Gecerli adresin defterdeki kaydi (secicinin ve Adreslerim'in "secili"
 * isareti): yalnizca hesabin adresi; varsayilan adres defterde yoktur.
 */
export function selectedAddress(
  addresses: readonly SavedAddress[],
  delivery: DeliveryAddressState,
): SavedAddress | undefined {
  if (delivery.status !== 'ready' || delivery.source !== 'account') {
    return undefined;
  }
  return addresses.find((address) => address.id === delivery.addressId);
}

const PENDING: DeliveryAddressState = { status: 'pending' };

function defaultAddress(reason: DefaultReason): DeliveryAddressState {
  return {
    status: 'ready',
    source: 'default',
    reason,
    title: DEFAULT_ADDRESS_TITLE,
    location: DEFAULT_DELIVERY_LOCATION,
  };
}

export function resolveDeliveryAddress(inputs: DeliveryInputs): DeliveryAddressState {
  const { session, userId, addresses, selection } = inputs;
  if (session === 'unknown') {
    return PENDING;
  }
  if (session === 'anonymous' || userId === null) {
    return defaultAddress('anonymous');
  }
  if (addresses === 'loading') {
    return PENDING;
  }
  if (addresses === 'error') {
    return defaultAddress('unavailable');
  }
  const [first] = addresses;
  if (first === undefined) {
    return defaultAddress('no-addresses');
  }
  const chosen = selection?.userId === userId ? findSelected(addresses, selection) : undefined;
  const address = chosen ?? first;
  return {
    status: 'ready',
    source: 'account',
    addressId: address.id,
    title: address.title,
    location: address.location,
  };
}

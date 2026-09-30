import { useEffect } from 'react';

import { shouldRehydrateAddress } from '../services/address-selection';
import { useAddressStore } from '../stores/useAddressStore';

/**
 * Baska sekmede secilen teslimat adresini bu sekmeye getirir (T9.5; sepetin
 * useCartStorageSync'i ile ayni yol).
 *
 * NEDEN: secim her sekmede bellekte de durur. Olay gelmeseydi iki sekme ayni
 * kullaniciya iki ayri adresin marketlerini gosterirdi. Tarayici `storage`
 * olayini YALNIZCA diger sekmelere yollar; olay gelince bu sekme depoyu yeniden
 * okur. Okuma ilk acilistaki yoldan gecer: surum ve dogrulama burada da gecerli.
 * Baska surumun kaydi okunmaz (bkz. shouldRehydrateAddress).
 */
export function useAddressStorageSync(): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (shouldRehydrateAddress(event.key, event.newValue)) {
        void useAddressStore.persist.rehydrate();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

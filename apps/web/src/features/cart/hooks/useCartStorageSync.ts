import { useEffect } from 'react';

import { isCartStorageKey } from '../services/cart-persistence';
import { useCartStore } from '../stores/useCartStore';

/**
 * Baska sekmede degisen sepeti bu sekmeye getirir (T7.6).
 *
 * NEDEN: sepet her sekmede bellekte de durur. Iki sekme acikken birinde
 * eklenen urun, digerinin eski sepeti yazilinca kaybolurdu. Tarayici `storage`
 * olayini YALNIZCA diger sekmelere yollar; olay gelince bu sekme depoyu
 * yeniden okur. Okuma ilk acilistaki yoldan gecer: dogrulama ve 24 saat kurali
 * burada da gecerlidir.
 */
export function useCartStorageSync(): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (isCartStorageKey(event.key)) {
        void useCartStore.persist.rehydrate();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

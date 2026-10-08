import { CONTENT_FALLBACK } from '@getir/contracts';
import type { GeoPoint } from '@getir/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AddressChangeGuardContext } from '../../../shared/address-change/guard';
import type { AddressChangeGuard } from '../../../shared/address-change/guard';
import { apiClient } from '../../../shared/api/client';
import { readPastCancel } from '../../../shared/api/read-past-cancel';
import { warnEvent } from '../../../shared/diagnostics/warn';
import { useToastStore } from '../../../shared/toast/toast-store';
import { useMarketListContent } from '../../content/hooks/useMarketListContent';
import { nearbyMarketsQuery } from '../../markets/api/queries';
import { MARKET_LIST_PATH, marketIdInPath } from '../../markets/routes';
import { approveAddressChange, leavesStorePage } from '../services/address-change';
import { useCartStore } from '../stores/useCartStore';

import { ClearCartDialog } from './ClearCartDialog';

/**
 * Yakin marketler sorgu onbelleginden (taze liste yeniden istenmez). Ayni
 * konumun sorgusu, onu izleyen pencere kapanirken iptal edilirse (ekleme
 * formu) bir kez daha okunur: karar "okunamadi"ya dusmesin.
 */
async function readNearby(queryClient: QueryClient, location: GeoPoint) {
  const list = await readPastCancel(() =>
    queryClient.fetchQuery(nearbyMarketsQuery(apiClient, location)),
  );
  return list.items.map((item) => item.market);
}

/**
 * Adres degisiminin bekcisi (F16): sepetin marketi yeni konuma teslim etmiyorsa
 * ortak onay penceresi "Sepetindeki <market> bu adrese teslimat yapmıyor...".
 * Karar approveAddressChange'te (saf); burada pencere, okuma ve sepet baglanir.
 * Sepet ve tost izin commit edilince (adres gercekten degisince); kullanici
 * yeni adrese teslim etmeyen bir marketin sayfasindaysa market listesine
 * gider (replace), tost orada gorunur. Her yeni degisim oncekini dusurur:
 * acik soru "Hayır" sayilir, suren okuma yok sayilir.
 * Market adi yalniz React metni; icerik gelmediyse yedek metin (pencere beklemez).
 */
export function AddressChangeGuardProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Commit anindaki sayfa (izin sonradan, kayit bitince de commit edilir).
  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);
  const show = useToastStore((toast) => toast.show);
  const texts = useMarketListContent()?.cart ?? CONTENT_FALLBACK.marketList.cart;
  const [marketName, setMarketName] = useState<string | null>(null);
  const answer = useRef<((proceed: boolean) => void) | null>(null);
  const latest = useRef(0);

  const settle = useCallback((proceed: boolean) => {
    answer.current?.(proceed);
    answer.current = null;
    setMarketName(null);
  }, []);

  const guard = useCallback<AddressChangeGuard>(
    (location) => {
      const ticket = ++latest.current;
      settle(false);
      const { market, items } = useCartStore.getState();
      return approveAddressChange({
        cartMarketId: market?.id ?? null,
        cartCount: items.length,
        readNearby: () => readNearby(queryClient, location),
        onCheckFailed: (error) => warnEvent('address-change-check-failed', error),
        isLatest: () => ticket === latest.current,
        ask: () =>
          new Promise<boolean>((resolve) => {
            answer.current = resolve;
            setMarketName(market?.name ?? '');
          }),
        clearCart: (serving) => {
          useCartStore.getState().clear();
          if (leavesStorePage(marketIdInPath(here.current), serving)) {
            navigate(MARKET_LIST_PATH, { replace: true });
          }
          show(texts.cartClearedToast);
        },
      });
    },
    [navigate, queryClient, settle, show, texts],
  );

  return (
    <AddressChangeGuardContext.Provider value={guard}>
      {children}
      {marketName !== null && (
        <ClearCartDialog
          question={`${texts.addressChangePrefix} ${marketName} ${texts.addressChangeSuffix}`}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </AddressChangeGuardContext.Provider>
  );
}

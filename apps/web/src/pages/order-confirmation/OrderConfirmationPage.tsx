import type { SavedCard } from '@getir/contracts';
import { useEffect, useId, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useSavedCards } from '../../features/cards/hooks/useSavedCards';
import { useCartPageContent } from '../../features/content/hooks/useCartPageContent';
import { useCheckoutContent } from '../../features/content/hooks/useCheckoutContent';
import { useFooterContent } from '../../features/content/hooks/useFooterContent';
import { useOrderConfirmationContent } from '../../features/content/hooks/useOrderConfirmationContent';
import { useOrdersContent } from '../../features/content/hooks/useOrdersContent';
import { usePaymentMethodsContent } from '../../features/content/hooks/usePaymentMethodsContent';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { MARKET_LIST_PATH } from '../../features/markets/routes';
import { useOrderDetail } from '../../features/orders/hooks/useOrderDetail';
import { ORDERS_PATH, orderPath } from '../../features/orders/routes';
import {
  confirmationFromState,
  confirmationHeading,
  confirmationKind,
  confirmationPayment,
  showsEstimate,
} from '../../features/orders/services/order-confirmation';
import type { ConfirmationHeading } from '../../features/orders/services/order-confirmation';
import { CourierTracking } from '../../features/tracking/ui/CourierTracking';
import { formatDeliveryTime } from '../../shared/services/format';
import { useSessionStore } from '../../shared/session/session-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';
import { SiteFooter } from '../../shared/ui/site-footer/SiteFooter';

import { OrderConfirmationView } from './OrderConfirmationView';

function useVaultCardList(userId: string, cardId: string | undefined) {
  return useSavedCards(userId, cardId !== undefined).data;
}

/**
 * Odenen kartin bulunacagi liste (S4): yalniz kartla odenen sipariste okunur.
 * Kart kasasi production paketinde KAPALI (__CARD_VAULT__): hook modul
 * yuklenirken secilir; production'da kasa okunmaz, ucu pakete girmez.
 */
const usePaidCardList: (
  userId: string,
  cardId: string | undefined,
) => readonly SavedCard[] | undefined = __CARD_VAULT__ ? useVaultCardList : () => undefined;

/** /siparis/:orderId/onay (F17): korumali, sade bar; "Sipariş Ver"den sonra. */
export function OrderConfirmationPage() {
  const footer = useFooterContent();
  return (
    <PageLayout
      variant="minimal"
      footer={footer !== undefined && <SiteFooter copyright={footer.copyright} />}
    >
      <RequireAuth>
        <SignedInConfirmation />
      </RequireAuth>
    </PageLayout>
  );
}

function SignedInConfirmation() {
  const userId = useSessionStore((state) => state.user?.id);
  const { orderId } = useParams();
  return userId === undefined || orderId === undefined ? null : (
    <ConfirmationSection key={orderId} userId={userId} orderId={orderId} />
  );
}

/**
 * Sayfa BAGLAR: siparis (GET /v1/orders/{id}; yenilemede de; 10 sn yoklama),
 * market adi ve tahmini varis (katalog), odenen kart (gezinme durumundaki
 * kimlik + kart listesi; yoksa "Kart"), kurye takibi (F22). Baslik akistan
 * gelen sonuctan ya da ilk okunan durumdan; ekran bir kez gosterildiyse
 * yoklamada durum degisse de kalir. Hic gosterilmeden onay olmayan durum
 * okunursa (iptal edilmis siparisin adresi) siparis detayina gecilir.
 */
function ConfirmationSection({
  userId,
  orderId,
}: {
  readonly userId: string;
  readonly orderId: string;
}) {
  const texts = useOrderConfirmationContent();
  const orderTexts = useOrdersContent();
  const checkout = useCheckoutContent();
  const cartPage = useCartPageContent();
  const methods = usePaymentMethodsContent();
  const order = useOrderDetail(userId, orderId);
  const market = useMarket(order.data?.marketId);
  const arrival = confirmationFromState(useLocation().state);
  const cards = usePaidCardList(userId, arrival.cardId);
  const status = order.data?.status;
  const [shown, setShown] = useState<ConfirmationHeading | undefined>(arrival.heading);
  useEffect(() => {
    const kind = status === undefined ? 'other' : confirmationKind(status);
    if (kind !== 'other') setShown(kind);
  }, [status]);
  const heading = confirmationHeading(status, shown);
  const [courierOpen, setCourierOpen] = useState(false);
  const courierButtonId = useId();
  const trackHeadingId = useId();

  if (heading === 'leave') {
    return <Navigate to={orderPath(orderId)} replace />;
  }
  if (
    texts === undefined ||
    orderTexts === undefined ||
    checkout === undefined ||
    cartPage === undefined ||
    methods === undefined
  ) {
    return null;
  }
  const marketName =
    market.data?.name ?? (market.error === null ? undefined : orderTexts.unknownMarketLabel);
  const estimate =
    order.data !== undefined && showsEstimate(order.data.status) && market.data !== undefined
      ? { label: cartPage.deliveryTimeLabel, value: formatDeliveryTime(market.data.deliveryTime) }
      : undefined;
  const payment = confirmationPayment({
    payment: order.data?.payment,
    cardId: arrival.cardId,
    cards,
    texts: orderTexts,
    brandLabels: methods.brandLabels,
  });

  return (
    <>
      <OrderConfirmationView
        texts={texts}
        heading={heading}
        orderTexts={orderTexts}
        detailTexts={checkout}
        order={order.data}
        error={order.error}
        onRetry={() => void order.refetch()}
        marketName={marketName}
        estimate={estimate}
        payment={payment}
        ordersHref={ORDERS_PATH}
        continueHref={MARKET_LIST_PATH}
        onWhereIsCourier={() => setCourierOpen(true)}
        courierButtonId={courierButtonId}
        trackHeadingId={trackHeadingId}
      />
      {order.data !== undefined && (
        <CourierTracking
          userId={userId}
          orderId={order.data.id}
          status={order.data.status}
          addressLine={order.data.address.line}
          open={courierOpen}
          onOpenChange={setCourierOpen}
          returnFocusId={courierButtonId}
          fallbackFocusId={trackHeadingId}
        />
      )}
    </>
  );
}

import { useParams } from 'react-router-dom';

import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useOrdersContent } from '../../features/content/hooks/useOrdersContent';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { useOrderDetail } from '../../features/orders/hooks/useOrderDetail';
import { ORDERS_PATH } from '../../features/orders/routes';
import { useSessionStore } from '../../shared/session/session-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { AccountLayout } from './AccountLayout';
import { OrderDetailView } from './OrderDetailView';

/** /hesabim/siparislerim/:orderId (T11.16): korumali; siparisin detayi. */
export function OrderDetailPage() {
  return (
    <PageLayout>
      <RequireAuth>
        <SignedInOrderDetail />
      </RequireAuth>
    </PageLayout>
  );
}

function SignedInOrderDetail() {
  const userId = useSessionStore((state) => state.user?.id);
  const { orderId } = useParams();
  return userId === undefined || orderId === undefined ? null : (
    <OrderDetailSection userId={userId} orderId={orderId} />
  );
}

/**
 * Sayfa BAGLAR: siparis (GET /v1/orders/{id}) ve market adi (katalog,
 * GET /v1/markets/{id}; siparis gelince istenir). Market bulunamazsa ya da
 * katalog cevap vermezse genel ad ("Market"): siparis yine gorunur.
 */
function OrderDetailSection({
  userId,
  orderId,
}: {
  readonly userId: string;
  readonly orderId: string;
}) {
  const texts = useOrdersContent();
  const order = useOrderDetail(userId, orderId);
  const market = useMarket(order.data?.marketId);
  const marketName =
    market.data?.name ?? (market.error === null ? undefined : texts?.unknownMarketLabel);

  return (
    <AccountLayout userId={userId} variant="nested">
      {texts !== undefined && (
        <OrderDetailView
          texts={texts}
          order={order.data}
          marketName={marketName}
          error={order.error}
          onRetry={() => void order.refetch()}
          listHref={ORDERS_PATH}
        />
      )}
    </AccountLayout>
  );
}

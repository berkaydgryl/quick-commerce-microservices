import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useOrdersContent } from '../../features/content/hooks/useOrdersContent';
import { useOrderHistory } from '../../features/orders/hooks/useOrderHistory';
import { useSessionStore } from '../../shared/session/session-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { AccountLayout } from './AccountLayout';
import { OrdersView } from './OrdersView';

/** /hesabim/siparislerim (T11.16): korumali; liste hesap sayfalarinin ortak icerik kabinda. */
export function OrdersPage() {
  return (
    <PageLayout>
      <RequireAuth>
        <SignedInOrders />
      </RequireAuth>
    </PageLayout>
  );
}

function SignedInOrders() {
  const userId = useSessionStore((state) => state.user?.id);
  return userId === undefined ? null : <OrdersSection userId={userId} />;
}

/**
 * Sayfa BAGLAR: gecmis (imlecle sayfali, useOrderHistory) ve metinler.
 * Sonraki sayfa basarisizsa yuklenmis liste yerinde kalir; hata ve tekrar
 * dene listenin altinda.
 */
function OrdersSection({ userId }: { readonly userId: string }) {
  const texts = useOrdersContent();
  const history = useOrderHistory(userId);

  return (
    <AccountLayout userId={userId} variant="section">
      {texts !== undefined && (
        <OrdersView
          texts={texts}
          orders={history.data}
          error={history.data === undefined ? history.error : null}
          onRetry={() => void history.refetch()}
          hasMore={history.hasNextPage}
          loadingMore={history.isFetchingNextPage}
          moreError={history.isFetchNextPageError ? history.error : null}
          onMore={() => void history.fetchNextPage()}
        />
      )}
    </AccountLayout>
  );
}

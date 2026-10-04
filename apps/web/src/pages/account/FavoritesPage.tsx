import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useFavoritesContent } from '../../features/content/hooks/useFavoritesContent';
import { useMarketListContent } from '../../features/content/hooks/useMarketListContent';
import { useFavorites } from '../../features/favorites/hooks/useFavorites';
import { FavoriteButton } from '../../features/favorites/ui/FavoriteButton';
import { useSessionStore } from '../../shared/session/session-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { AccountLayout } from './AccountLayout';
import { FavoriteMarketsView } from './FavoriteMarketsView';

/** /hesabim/favoriler (T11.13): korumali; profil duzeninin sag tarafinda favoriler. */
export function FavoritesPage() {
  return (
    <PageLayout>
      <RequireAuth>
        <SignedInFavorites />
      </RequireAuth>
    </PageLayout>
  );
}

/**
 * Sayfa BIRLESTIRIR: kart (markets) favorileri tanimaz; kalp (favorites)
 * kartin kapagina burada yerlesir. Metinler icerikten (gelmezse yedek).
 */
function SignedInFavorites() {
  const userId = useSessionStore((state) => state.user?.id);
  const favorites = useFavorites();
  const texts = useFavoritesContent();
  const listTexts = useMarketListContent();

  if (userId === undefined) {
    return null;
  }
  return (
    <AccountLayout userId={userId}>
      {texts !== undefined && listTexts !== undefined && (
        <FavoriteMarketsView
          texts={texts}
          listTexts={listTexts}
          list={favorites.data}
          error={favorites.error}
          onRetry={() => void favorites.refetch()}
          renderAction={(market) => <FavoriteButton market={market} texts={texts} />}
        />
      )}
    </AccountLayout>
  );
}

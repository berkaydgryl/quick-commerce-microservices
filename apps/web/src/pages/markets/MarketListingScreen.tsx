import { useDeliveryLocation } from '../../features/address/hooks/useDeliveryLocation';
import { CartBar } from '../../features/cart/ui/CartBar';
import { CartPanel } from '../../features/cart/ui/CartPanel';
import { useFavoritesContent } from '../../features/content/hooks/useFavoritesContent';
import { useMarketListContent } from '../../features/content/hooks/useMarketListContent';
import { FavoriteButton } from '../../features/favorites/ui/FavoriteButton';
import { marketPath } from '../../features/markets/routes';
import { MarketListing } from '../../features/markets/ui/MarketListing';

interface MarketListingScreenProps {
  /** Liste basliginin duzeyi: ana sayfada 2 (logo h1), /markets'ta 1. */
  readonly headingLevel: 1 | 2;
}

/**
 * Market listesi ekrani (T11.12): ana sayfa ve /markets ayni ekrani kullanir.
 * Sayfa BIRLESTIRIR: liste (markets) sepeti ve favorileri tanimaz, sepet
 * (cart) market adreslerini tanimaz; Sepetim paneli listenin sag sutun
 * yuvasina, sepet cubugu sayfanin altina, favori kalbi (T11.13) kartin
 * kapagina burada yerlesir. Metinler icerik ucundan (gelmezse icerik
 * yedegi); marketler secili teslimat adresinin konumuyla sorulur.
 */
export function MarketListingScreen({ headingLevel }: MarketListingScreenProps) {
  const location = useDeliveryLocation();
  const content = useMarketListContent();
  const favoriteTexts = useFavoritesContent();

  return (
    <>
      <MarketListing
        location={location}
        content={content}
        headingLevel={headingLevel}
        aside={content && <CartPanel texts={content.cart} cartHref={marketPath} />}
        {...(favoriteTexts === undefined
          ? {}
          : {
              renderCardAction: (market) => (
                <FavoriteButton market={market} texts={favoriteTexts} />
              ),
            })}
      />
      {content !== undefined && <CartBar texts={content.cart} cartHref={marketPath} />}
    </>
  );
}

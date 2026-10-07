import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useCartStore } from '../../features/cart/stores/useCartStore';
import { useCartPageContent } from '../../features/content/hooks/useCartPageContent';
import { useFooterContent } from '../../features/content/hooks/useFooterContent';
import { useMarketListContent } from '../../features/content/hooks/useMarketListContent';
import { useMarketPageContent } from '../../features/content/hooks/useMarketPageContent';
import { useAppHeaderContent } from '../../features/content/hooks/useAppHeaderContent';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { DeliveryTimeChip } from '../../features/markets/ui/DeliveryTimeChip';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';
import { SiteFooter } from '../../shared/ui/site-footer/SiteFooter';

import { CartScreen } from './CartScreen';

/**
 * /sepet (T16.3; referans getircarsi sepet sayfasi): sade ust bar (logo,
 * teslimat adresi, sepetin marketinin teslim suresi), sepet ve alt bilgi.
 * Oturum ister (PM karari L5): adres karti oturumun adresidir, odeme de oturum
 * ister; girisle bu sayfaya donulur (?next=/sepet). Metinler icerik ucundan
 * (gelmezse yedek); adresin parca etiketleri adres formundan (addressSetup).
 */
export function CartPage() {
  const page = useCartPageContent();
  const list = useMarketListContent();
  const marketTexts = useMarketPageContent();
  const footer = useFooterContent();
  const setup = useAppHeaderContent()?.addressSetup;
  const marketId = useCartStore((cart) => cart.market?.id);
  const market = useMarket(marketId);

  return (
    <PageLayout
      variant="minimal"
      headerExtra={
        market.data !== undefined &&
        page !== undefined && (
          <DeliveryTimeChip
            deliveryTime={market.data.deliveryTime}
            texts={{ shortLabel: page.deliveryTimeShortLabel, label: page.deliveryTimeLabel }}
          />
        )
      }
      footer={footer !== undefined && <SiteFooter copyright={footer.copyright} />}
    >
      <RequireAuth>
        {page !== undefined && list !== undefined && marketTexts !== undefined && (
          <CartScreen page={page} list={list} marketTexts={marketTexts} setup={setup} />
        )}
      </RequireAuth>
    </PageLayout>
  );
}

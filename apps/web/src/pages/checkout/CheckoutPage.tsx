import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useCartStore } from '../../features/cart/stores/useCartStore';
import { useCartPageContent } from '../../features/content/hooks/useCartPageContent';
import { useCheckoutContent } from '../../features/content/hooks/useCheckoutContent';
import { useFooterContent } from '../../features/content/hooks/useFooterContent';
import { useMarketListContent } from '../../features/content/hooks/useMarketListContent';
import { usePaymentMethodsContent } from '../../features/content/hooks/usePaymentMethodsContent';
import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
import { useMarket } from '../../features/markets/hooks/useMarket';
import { DeliveryTimeChip } from '../../features/markets/ui/DeliveryTimeChip';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';
import { SiteFooter } from '../../shared/ui/site-footer/SiteFooter';

import { CheckoutScreen } from './CheckoutScreen';

/**
 * /odeme (T17.1; referans getircarsi odeme sayfasi; KAMPANYA YOK): sepet
 * sayfasinin sade ust bari ve alt bilgisi. Oturum ister; sepet bossa sepet
 * sayfasina doner. Metinler icerik ucundan (gelmezse yedek): odeme sayfasi,
 * sepet sayfasinin adres ve sure metinleri, kart adlari (paymentMethods).
 */
export function CheckoutPage() {
  const texts = useCheckoutContent();
  const cartPage = useCartPageContent();
  const list = useMarketListContent();
  const cardTexts = usePaymentMethodsContent();
  const footer = useFooterContent();
  const setup = useWelcomeContent().data?.addressSetup;
  const marketId = useCartStore((cart) => cart.market?.id);
  const market = useMarket(marketId);
  const ready =
    texts !== undefined && cartPage !== undefined && list !== undefined && cardTexts !== undefined;

  return (
    <PageLayout
      variant="minimal"
      headerExtra={
        market.data !== undefined &&
        cartPage !== undefined && (
          <DeliveryTimeChip
            deliveryTime={market.data.deliveryTime}
            texts={{
              shortLabel: cartPage.deliveryTimeShortLabel,
              label: cartPage.deliveryTimeLabel,
            }}
          />
        )
      }
      footer={footer !== undefined && <SiteFooter copyright={footer.copyright} />}
    >
      <RequireAuth>
        {ready && (
          <CheckoutScreen
            texts={texts}
            cartPage={cartPage}
            list={list}
            cardTexts={cardTexts}
            setup={setup}
            market={market.data}
          />
        )}
      </RequireAuth>
    </PageLayout>
  );
}

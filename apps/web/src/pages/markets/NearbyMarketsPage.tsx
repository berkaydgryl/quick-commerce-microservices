import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { MarketListingScreen } from './MarketListingScreen';

/**
 * /markets - teslimat adresine hizmet veren marketler: ana sayfadaki market
 * listesinin aynisi (T11.12), sayfanin ana basligi listenin basligidir.
 */
export function NearbyMarketsPage() {
  return (
    <PageLayout>
      <MarketListingScreen headingLevel={1} />
    </PageLayout>
  );
}

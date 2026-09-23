import { DEFAULT_DELIVERY_LOCATION } from '../../features/markets/constants';
import { NearbyMarketsSection } from '../../features/markets/ui/NearbyMarketsSection';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

/**
 * /markets - teslimat konumuna hizmet veren marketler. Konum T9.5'e (adres
 * secimi) kadar sabit "Ev" adresidir.
 */
export function NearbyMarketsPage() {
  return (
    <PageLayout>
      <NearbyMarketsSection location={DEFAULT_DELIVERY_LOCATION} />
    </PageLayout>
  );
}

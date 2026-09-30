import { useDeliveryLocation } from '../../features/address/hooks/useDeliveryLocation';
import { NearbyMarketsSection } from '../../features/markets/ui/NearbyMarketsSection';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

/**
 * /markets - teslimat adresine hizmet veren marketler. Adres ana sayfada
 * secilir (T9.5); bu sayfa secili adresi izler.
 */
export function NearbyMarketsPage() {
  const location = useDeliveryLocation();

  return (
    <PageLayout>
      <NearbyMarketsSection location={location} />
    </PageLayout>
  );
}

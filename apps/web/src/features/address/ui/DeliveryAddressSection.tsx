import type { AddressSetupContent } from '@getir/contracts';

import { QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useAddressBook } from '../hooks/useAddressBook';
import { selectedAddress } from '../services/delivery-address';
import { deliveryLabel } from '../services/delivery-label';

import { DeliveryAddressCard } from './DeliveryAddressCard';
import type { DeliveryAddressCardTexts } from './DeliveryAddressCard';

interface DeliveryAddressSectionProps {
  readonly texts: DeliveryAddressCardTexts & { readonly loadingLabel: string };
  /** Adres formunun metinleri: tur adlari ("Ev") ve parca etiketleri. */
  readonly setup: AddressSetupContent;
}

/**
 * Secili teslimat adresinin karti (T16.3): ust bardaki secimle AYNI adres
 * (useAddressBook); secim degisince kart da degisir. Defter yuklenirken durum.
 */
export function DeliveryAddressSection({ texts, setup }: DeliveryAddressSectionProps) {
  const { delivery, addresses } = useAddressBook();
  if (delivery.status === 'pending') {
    return <QueryLoading>{texts.loadingLabel}</QueryLoading>;
  }
  return (
    <DeliveryAddressCard
      address={selectedAddress(addresses, delivery)}
      label={deliveryLabel(delivery, setup.kinds)}
      texts={texts}
      partLabels={setup}
    />
  );
}

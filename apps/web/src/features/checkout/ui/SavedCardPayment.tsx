import { QueryError } from '../../../shared/ui/query-status/QueryStatus';
import { useSavedCards } from '../../cards/hooks/useSavedCards';
import { defaultCard } from '../services/selected-card';

import { PaymentMethodView } from './PaymentMethodView';
import type { PaymentCardTexts, PaymentMethodTexts } from './PaymentMethodView';

interface SavedCardPaymentProps {
  readonly userId: string;
  readonly texts: PaymentMethodTexts;
  readonly cardTexts: PaymentCardTexts;
}

/**
 * Kart kasasindan secili kart (T17.1): kayitli kartlar okunur, suresi
 * gecmemis en yeni kart secilir (M4); okunamazsa durum ve "Tekrar dene" (kart
 * yok sanilmasin). YALNIZCA kart kasasi acik pakette (__CARD_VAULT__)
 * derlenir: kasanin ucu production paketinde gecmez.
 */
export function SavedCardPayment({ userId, texts, cardTexts }: SavedCardPaymentProps) {
  const cards = useSavedCards(userId);
  return (
    <PaymentMethodView
      loading={cards.isPending}
      problem={
        cards.error === null ? undefined : (
          <QueryError error={cards.error} onRetry={() => void cards.refetch()} />
        )
      }
      card={cards.data === undefined ? undefined : defaultCard(cards.data)}
      texts={texts}
      cardTexts={cardTexts}
    />
  );
}

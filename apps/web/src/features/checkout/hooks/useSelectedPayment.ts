import type { DeliveryPaymentKind } from '@getir/contracts';
import { useState } from 'react';

import { effectivePayment } from '../services/payment-choice';
import type { PaymentChoice } from '../services/payment-choice';

import { useSelectedCard } from './useSelectedCard';
import type { SelectedCard } from './useSelectedCard';

export interface SelectedPayment {
  /** Kartlarin durumu (yukleniyor, hata, uygulanan kart; F5). */
  readonly cards: SelectedCard;
  /** Odemede kullanilacak secim; yoksa undefined (siparis verilemez). */
  readonly choice: PaymentChoice | undefined;
  /** Penceredeki "Seç": kart ya da kapida odeme sayfaya yazilir. */
  readonly choose: (choice: PaymentChoice) => void;
  /** Kapida odeme reddedildi (422): secim karta doner (PM S3 (a)). */
  readonly dropOnDelivery: () => void;
}

/**
 * Odeme sayfasinin secimi (F12): kart ya da kapida odeme (nakit ya da POS).
 * Varsayilan suresi gecmemis en yeni kart (PM S2 (a)); kart yoksa secim yok.
 * Secim yalnizca bu sayfanin durumunda. Kasa kapali pakette kart yok, kapida
 * odeme secilebilir.
 */
export function useSelectedPayment(userId: string): SelectedPayment {
  const cards = useSelectedCard(userId);
  const [onDelivery, setOnDelivery] = useState<DeliveryPaymentKind | undefined>();
  return {
    cards,
    choice: effectivePayment(onDelivery, cards.card?.id),
    choose: (choice) => {
      if (choice.kind === 'onDelivery') {
        setOnDelivery(choice.onDelivery);
        return;
      }
      setOnDelivery(undefined);
      cards.choose(choice.cardId);
    },
    dropOnDelivery: () => setOnDelivery(undefined),
  };
}

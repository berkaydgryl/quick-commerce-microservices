import type { SavedCard } from '@getir/contracts';
import { useState } from 'react';

import { useSavedCards } from '../../cards/hooks/useSavedCards';
import { effectiveCard } from '../services/selected-card';

export interface SelectedCard {
  readonly loading: boolean;
  readonly error: Error | null;
  readonly retry: () => void;
  /** Odemede kullanilacak kart (P2): secilen gecerliyse o, yoksa suresi gecmemis en yeni (M4). */
  readonly card: SavedCard | undefined;
  /** Penceredeki "Seç": secilen kart sayfaya yazilir (F5). */
  readonly choose: (cardId: string) => void;
}

const NO_CARD: SelectedCard = {
  loading: false,
  error: null,
  retry: () => undefined,
  card: undefined,
  choose: () => undefined,
};

function useVaultCard(userId: string): SelectedCard {
  const cards = useSavedCards(userId);
  const [chosenId, setChosenId] = useState<string | undefined>();
  return {
    loading: cards.isPending,
    error: cards.error,
    retry: () => void cards.refetch(),
    card: cards.data === undefined ? undefined : effectiveCard(cards.data, chosenId),
    choose: setChosenId,
  };
}

function useNoCard(): SelectedCard {
  return NO_CARD;
}

/**
 * Odemede secili kart (T17.1; T12.4'te siparise cardId olarak gider; F5'te
 * "Ödeme Yöntemi Seç" penceresiyle degisir). Secim yalnizca bu sayfanin
 * durumunda: kart silinirse ya da suresi dolarsa kural en yeni gecerli karta
 * doner (effectiveCard). Kart kasasi production paketinde KAPALI
 * (__CARD_VAULT__, K1 (a)): hook modul yuklenirken bir kez secilir (bayrak
 * sabit katlanir); production'da kasa okunmaz, ucu pakete girmez (paket
 * taramasi) ve kart yoktur: siparis verilemez.
 */
export const useSelectedCard: (userId: string) => SelectedCard = __CARD_VAULT__
  ? useVaultCard
  : useNoCard;

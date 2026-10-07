import type { SavedCard } from '@getir/contracts';

import { useSavedCards } from '../../cards/hooks/useSavedCards';
import { defaultCard } from '../services/selected-card';

export interface SelectedCard {
  readonly loading: boolean;
  readonly error: Error | null;
  readonly retry: () => void;
  /** Suresi gecmemis en yeni kart (M4); yoksa undefined. */
  readonly card: SavedCard | undefined;
}

const NO_CARD: SelectedCard = {
  loading: false,
  error: null,
  retry: () => undefined,
  card: undefined,
};

function useVaultCard(userId: string): SelectedCard {
  const cards = useSavedCards(userId);
  return {
    loading: cards.isPending,
    error: cards.error,
    retry: () => void cards.refetch(),
    card: cards.data === undefined ? undefined : defaultCard(cards.data),
  };
}

function useNoCard(): SelectedCard {
  return NO_CARD;
}

/**
 * Odemede secili kart (T17.1; T12.4'te siparise cardId olarak gider). Kart
 * kasasi production paketinde KAPALI (__CARD_VAULT__, K1 (a)): hook modul
 * yuklenirken bir kez secilir (bayrak sabit katlanir); production'da kasa
 * okunmaz, ucu pakete girmez (paket taramasi) ve kart yoktur: siparis verilemez.
 */
export const useSelectedCard: (userId: string) => SelectedCard = __CARD_VAULT__
  ? useVaultCard
  : useNoCard;

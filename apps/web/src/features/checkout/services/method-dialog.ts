import type { DeliveryPaymentKind, SavedCard } from '@getir/contracts';

import type { PaymentChoice } from './payment-choice';
import { effectiveCard } from './selected-card';

/**
 * "Ödeme Yöntemi Seç" penceresinin durumu (T17.1; F5). Tek pencere, uc adim
 * (P1): liste, kart ekleme, silme onayi. Saf: arayuzden bagimsiz test edilir.
 */
export type MethodStep =
  | { readonly kind: 'list' }
  | { readonly kind: 'add' }
  | { readonly kind: 'delete'; readonly card: SavedCard };

/** Liste adimi acilinca odak (P4): secili radyo, "+ Kredi/Banka Kartı" ya da bir kartin "Kartı Sil"i. */
export type ListFocus =
  | { readonly kind: 'selected' }
  | { readonly kind: 'add' }
  | { readonly kind: 'delete'; readonly cardId: string };

export interface MethodDialogState {
  readonly step: MethodStep;
  /** Bekleyen secim; sayfaya yalnizca "Seç" ile yazilir (P3). */
  readonly pendingId: string | undefined;
  /** Bekleyen kapida odeme (F12); secilmisse kart secimini gecersiz kilar. */
  readonly pendingOnDelivery: DeliveryPaymentKind | undefined;
  readonly focus: ListFocus;
  /** Ekleme adiminin sirasi: geri donulup yeniden acilan adim eski kaydin sonucunu almaz. */
  readonly addSession: number;
}

export type MethodDialogAction =
  | { readonly type: 'pick'; readonly cardId: string }
  | { readonly type: 'pickOnDelivery'; readonly onDelivery: DeliveryPaymentKind }
  | { readonly type: 'openAdd' }
  | { readonly type: 'openDelete'; readonly card: SavedCard }
  | { readonly type: 'back' }
  | { readonly type: 'added'; readonly card: SavedCard; readonly session: number }
  | { readonly type: 'deleted'; readonly cardId: string };

/**
 * Pencerenin ilk adimi. Sayfa F12'den beri yalniz listeyi acar ("Değiştir" / "Seç";
 * ekleme listedeki "+ Kredi/Banka Kartı" ile); 'add' girisi ekleme adiminin testleri icin kalir.
 */
export type MethodDialogStart = 'list' | 'add';

const LIST: MethodStep = { kind: 'list' };
const SELECTED: ListFocus = { kind: 'selected' };

/** Pencere sayfada uygulanan secimle (kart ya da kapida odeme; F12) acilir. */
export function openMethodDialog(
  appliedId: string | undefined,
  start: MethodDialogStart,
  appliedOnDelivery?: DeliveryPaymentKind,
): MethodDialogState {
  return {
    step: start === 'add' ? { kind: 'add' } : LIST,
    pendingId: appliedId,
    pendingOnDelivery: appliedOnDelivery,
    focus: start === 'add' ? { kind: 'add' } : SELECTED,
    addSession: start === 'add' ? 1 : 0,
  };
}

/** Geri (ok, Esc, "Vazgeç"): odak adimi acan dugmeye doner (P4). */
function backFocus(step: MethodStep): ListFocus {
  return step.kind === 'delete' ? { kind: 'delete', cardId: step.card.id } : { kind: 'add' };
}

/**
 * Gecisler (P2-P4):
 *   - eklenen kart listede SECILI gelir, odak onun radyosunda (P3);
 *   - silinen kart bekleyen secimse secim birakilir: gorunen secim
 *     effectiveCard ile kalan en yeni gecerli kart olur (P2);
 *   - geri donuste odak adimi acan dugmede.
 */
export function methodDialogReducer(
  state: MethodDialogState,
  action: MethodDialogAction,
): MethodDialogState {
  switch (action.type) {
    case 'pick':
      return { ...state, pendingId: action.cardId, pendingOnDelivery: undefined };
    case 'pickOnDelivery':
      return { ...state, pendingOnDelivery: action.onDelivery };
    case 'openAdd':
      return { ...state, step: { kind: 'add' }, addSession: state.addSession + 1 };
    case 'openDelete':
      return { ...state, step: { kind: 'delete', card: action.card } };
    case 'back':
      return state.step.kind === 'list'
        ? state
        : { ...state, step: LIST, focus: backFocus(state.step) };
    case 'added':
      return state.step.kind === 'add' && action.session === state.addSession
        ? {
            ...state,
            step: LIST,
            pendingId: action.card.id,
            pendingOnDelivery: undefined,
            focus: SELECTED,
          }
        : state;
    case 'deleted':
      return {
        ...state,
        step: LIST,
        pendingId: state.pendingId === action.cardId ? undefined : state.pendingId,
        focus: SELECTED,
      };
  }
}

/**
 * Pencerenin bekleyen secimi (F12): kapida odeme secildiyse o; degilse bekleyen
 * kart (silinmis ya da suresi gecmisse en yeni gecerli kart, effectiveCard).
 */
export function pendingChoice(
  state: MethodDialogState,
  cards: readonly SavedCard[],
): PaymentChoice | undefined {
  if (state.pendingOnDelivery !== undefined) {
    return { kind: 'onDelivery', onDelivery: state.pendingOnDelivery };
  }
  const card = effectiveCard(cards, state.pendingId);
  return card === undefined ? undefined : { kind: 'card', cardId: card.id };
}

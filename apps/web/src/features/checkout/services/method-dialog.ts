import type { SavedCard } from '@getir/contracts';

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
  readonly focus: ListFocus;
  /** Ekleme adiminin sirasi: geri donulup yeniden acilan adim eski kaydin sonucunu almaz. */
  readonly addSession: number;
}

export type MethodDialogAction =
  | { readonly type: 'pick'; readonly cardId: string }
  | { readonly type: 'openAdd' }
  | { readonly type: 'openDelete'; readonly card: SavedCard }
  | { readonly type: 'back' }
  | { readonly type: 'added'; readonly card: SavedCard; readonly session: number }
  | { readonly type: 'deleted'; readonly cardId: string };

/** Pencerenin ilk adimi: "Değiştir" listeyi, kart yokken "Kart ekle" ekleme adimini acar. */
export type MethodDialogStart = 'list' | 'add';

const LIST: MethodStep = { kind: 'list' };
const SELECTED: ListFocus = { kind: 'selected' };

/** Pencere sayfada uygulanan kartla (appliedId) secili acilir. */
export function openMethodDialog(
  appliedId: string | undefined,
  start: MethodDialogStart,
): MethodDialogState {
  return {
    step: start === 'add' ? { kind: 'add' } : LIST,
    pendingId: appliedId,
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
      return { ...state, pendingId: action.cardId };
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
        ? { ...state, step: LIST, pendingId: action.card.id, focus: SELECTED }
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

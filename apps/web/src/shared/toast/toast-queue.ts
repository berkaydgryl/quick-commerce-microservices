/**
 * Bildirim (toast) kuyrugunun saf kurallari (T11.13; roadmap'te T15.4'ten one
 * alindi): en fazla TOAST_MAX bildirim ekranda kalir, yenisi gelince en eskisi
 * duser; her bildirim TOAST_DURATION_MS sonra kendiliginden kapanir.
 */

/** Ekranda ayni anda en fazla bu kadar bildirim. */
export const TOAST_MAX = 3;

/** Bildirimin ekranda kalma suresi. Kullanici daha once kapatabilir. */
export const TOAST_DURATION_MS = 5000;

export interface Toast {
  readonly id: number;
  readonly message: string;
}

/** Yeni bildirimi sona ekler; sinir asilirsa en eskiler duser. */
export function pushToast(toasts: readonly Toast[], toast: Toast): readonly Toast[] {
  return [...toasts, toast].slice(-TOAST_MAX);
}

/** Bildirimi kaldirir; olmayan kimlik listeyi degistirmez. */
export function removeToast(toasts: readonly Toast[], id: number): readonly Toast[] {
  return toasts.some((toast) => toast.id === id)
    ? toasts.filter((toast) => toast.id !== id)
    : toasts;
}

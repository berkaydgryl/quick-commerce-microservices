import { create } from 'zustand';

import { pushToast, removeToast } from './toast-queue';
import type { Toast } from './toast-queue';

/**
 * Bildirim kuyrugu (istemci durumu -> Zustand; T11.13). Herhangi bir ozellik
 * show() ile bildirim birakir (or. kalp tiklamasi sunucuda basarisiz oldu);
 * uygulamanin tek Toaster'i cizer ve kapatir.
 */
interface ToastState {
  readonly toasts: readonly Toast[];
  readonly show: (message: string) => void;
  readonly dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>()((set) => {
  let nextId = 0;
  return {
    toasts: [],
    show: (message) => {
      nextId += 1;
      const toast = { id: nextId, message };
      set((state) => ({ toasts: pushToast(state.toasts, toast) }));
    },
    dismiss: (id) => set((state) => ({ toasts: removeToast(state.toasts, id) })),
  };
});

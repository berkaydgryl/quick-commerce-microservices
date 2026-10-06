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
  /** Bildirim; `spoken` verilirse ekran okuyucu onu okur, gorunen metin gizlenir (T11.17 K4). */
  readonly show: (message: string, spoken?: string) => void;
  readonly dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>()((set) => {
  let nextId = 0;
  return {
    toasts: [],
    show: (message, spoken) => {
      nextId += 1;
      const toast =
        spoken === undefined ? { id: nextId, message } : { id: nextId, message, spoken };
      set((state) => ({ toasts: pushToast(state.toasts, toast) }));
    },
    dismiss: (id) => set((state) => ({ toasts: removeToast(state.toasts, id) })),
  };
});

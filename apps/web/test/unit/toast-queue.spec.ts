/** Bildirim kuyrugu (T11.13; roadmap T15.4'ten one alindi): sinir ve kaldirma. */

import { describe, expect, it } from 'vitest';

import { pushToast, removeToast, TOAST_MAX } from '../../src/shared/toast/toast-queue';
import { useToastStore } from '../../src/shared/toast/toast-store';

const toast = (id: number) => ({ id, message: `bildirim ${id}` });

describe('toast kuyrugu', () => {
  it(`en fazla ${TOAST_MAX} bildirim; yenisi gelince en eskisi duser`, () => {
    let toasts = pushToast([], toast(1));
    for (let id = 2; id <= TOAST_MAX + 1; id += 1) {
      toasts = pushToast(toasts, toast(id));
    }

    expect(toasts.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it('kaldirma yalnizca o bildirimi siler; olmayan kimlik listeyi degistirmez', () => {
    const toasts = [toast(1), toast(2)];

    expect(removeToast(toasts, 1)).toEqual([toast(2)]);
    expect(removeToast(toasts, 9)).toBe(toasts);
  });

  it('depo: show artan kimlikle ekler, dismiss kaldirir', () => {
    const { show, dismiss } = useToastStore.getState();
    show('Favori güncellenemedi, tekrar dene.');
    show('İkinci');
    const [first, second] = useToastStore.getState().toasts;

    expect(first?.message).toBe('Favori güncellenemedi, tekrar dene.');
    expect((second?.id ?? 0) > (first?.id ?? 0)).toBe(true);

    dismiss(first?.id ?? -1);
    expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual(['İkinci']);
  });
});

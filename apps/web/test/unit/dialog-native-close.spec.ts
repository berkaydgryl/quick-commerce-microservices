/**
 * Ortak pencere (T11.17, QA O2): tarayici pencereyi kendisi kapatirsa (Chrome:
 * art arda ikinci Esc iptal edilemez) pencere geri acilir ve Esc'nin isi
 * yapilir; bekleyen is varsa (dugme pasif) yalnizca geri acilir. Eski olay
 * (pencere zaten acik ya da sayfadan kalkmis) yok sayilir. Tek Esc tek eylem
 * (QA K1): iptal edilemeyen Esc'de cancel bir sey yapmaz, isi close yapar.
 */

import { describe, expect, it, vi } from 'vitest';

import { handleCancel, syncNativeClose } from '../../src/shared/ui/dialog/native-close';
import type { NativeDialog } from '../../src/shared/ui/dialog/native-close';

function fakeDialog(state: { open: boolean; isConnected: boolean }) {
  const element: NativeDialog = {
    ...state,
    showModal: vi.fn(() => {
      element.open = true;
    }),
  };
  return element;
}

describe('syncNativeClose (QA O2)', () => {
  it('tarayici kapatti: pencere geri acilir, Esc isi (kapat) yapilir', () => {
    const element = fakeDialog({ open: false, isConnected: true });
    const onAction = vi.fn();

    syncNativeClose(element, { label: 'Kapat', onAction });

    expect(element.showModal).toHaveBeenCalledOnce();
    expect(element.open).toBe(true);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('silme surerken (dugme pasif): yalnizca geri acilir, pencere kapanmaz', () => {
    const element = fakeDialog({ open: false, isConnected: true });
    const onAction = vi.fn();

    syncNativeClose(element, { label: 'Kapat', onAction, disabled: true });

    expect(element.showModal).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('Esc isi olmayan pencere de geri acilir', () => {
    const element = fakeDialog({ open: false, isConnected: true });

    syncNativeClose(element, undefined);

    expect(element.showModal).toHaveBeenCalledOnce();
  });

  it('eski olay yok sayilir: pencere acik (StrictMode) ya da sayfadan kalkmis', () => {
    const open = fakeDialog({ open: true, isConnected: true });
    const gone = fakeDialog({ open: false, isConnected: false });
    const onAction = vi.fn();

    syncNativeClose(open, { label: 'Kapat', onAction });
    syncNativeClose(gone, { label: 'Kapat', onAction });

    expect(open.showModal).not.toHaveBeenCalled();
    expect(gone.showModal).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('handleCancel + syncNativeClose: tek Esc tek eylem (QA K1)', () => {
  const cancelEvent = (cancelable: boolean) => ({ cancelable, preventDefault: vi.fn() });

  it('iptal edilebilen Esc: tarayici kapatmaz, eylem bir kez', () => {
    const onAction = vi.fn();
    const event = cancelEvent(true);

    handleCancel(event, { label: 'Kapat', onAction });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('iptal edilemeyen Esc (Chrome ikinci Esc): cancel + close birlikte eylemi BIR kez yapar', () => {
    const logout = vi.fn();
    const escape = { label: 'Kapat', onAction: logout };
    const element = fakeDialog({ open: true, isConnected: true });
    const event = cancelEvent(false);

    handleCancel(event, escape);
    element.open = false; // tarayici kapatti
    syncNativeClose(element, escape);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('"geri" adimi: tek Esc bir adim geri gider (iki adim degil), pencere acik kalir', () => {
    const back = vi.fn();
    const element = fakeDialog({ open: true, isConnected: true });

    handleCancel(cancelEvent(false), { label: 'Geri', onAction: back });
    element.open = false;
    syncNativeClose(element, { label: 'Geri', onAction: back });

    expect(back).toHaveBeenCalledOnce();
    expect(element.open).toBe(true);
  });

  it('bekleyen is (dugme pasif): Esc bir sey yapmaz', () => {
    const onAction = vi.fn();
    const event = cancelEvent(true);

    handleCancel(event, { label: 'Kapat', onAction, disabled: true });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });
});

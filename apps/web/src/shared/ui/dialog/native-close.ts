import type { DialogAction } from './Dialog';

/** Pencerenin tarayici durumuna bakan kisim (testte sahte oge). */
export type NativeDialog = Pick<HTMLDialogElement, 'open' | 'isConnected' | 'showModal'>;

/** Esc'nin cancel olayi (React olayi ya da testte sahte olay). */
export interface CancelEvent {
  readonly cancelable: boolean;
  preventDefault(): void;
}

/**
 * Esc (cancel olayi). Iptal edilebiliyorsa tarayici kapatmasin, Esc'nin isini
 * (geri ya da kapat) biz yapariz. Iptal edilemiyorsa (Chrome: arada
 * etkilesim olmayan ikinci Esc) burada HICBIR SEY yapilmaz: tarayici kapatir,
 * close olayinda syncNativeClose geri acar ve isi orada BIR kez yapar.
 * Boylece tek Esc tek eylemdir (QA K1: "geri" once geri gidip sonra
 * kapanmaz; ilk adres penceresinde cikis iki kez cagrilmaz).
 */
export function handleCancel(event: CancelEvent, escape: DialogAction | undefined): void {
  if (!event.cancelable) {
    return;
  }
  event.preventDefault();
  if (escape !== undefined && escape.disabled !== true) {
    escape.onAction();
  }
}

/**
 * Tarayici pencereyi KENDISI kapattiysa (QA O2) React durumunu esitler.
 * Esc'nin cancel olayini iptal ediyoruz; ama Chrome arada kullanici etkilesimi
 * olmayan IKINCI Esc'yi iptal edilemez sayar ve pencereyi kapatir. React
 * pencereyi acik sanir; sonraki acilis (useLayoutEffect []) tekrar calismaz
 * ve ornegin bir sonraki cop kutusu pencere acmaz. Cozum: pencere hemen geri
 * acilir; Esc'nin isi (geri ya da kapat) bekleyen bir is yoksa yapilir.
 *
 * Eski olay yok sayilir: pencere hala aciksa (StrictMode'da kapat-ac sirasi)
 * ya da sayfadan kalktiysa (kapanis bizim cikisimiz).
 */
export function syncNativeClose(element: NativeDialog, escape: DialogAction | undefined): void {
  if (element.open || !element.isConnected) {
    return;
  }
  element.showModal();
  if (escape !== undefined && escape.disabled !== true) {
    escape.onAction();
  }
}

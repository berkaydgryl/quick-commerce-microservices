/**
 * Pencere olaylarinin kararlari (F13; saf, test edilir):
 *   - olay bu pencerenin mi: icindeki pencerenin (ust uste onay) cancel/close
 *     olayi React agacinda yukari ulasir; dis pencere onu kendi saymamali;
 *   - karartmaya tiklama: yalniz onay turunde iptal, islem surerken degil; basma
 *     da karartmada olmali (kutunun icinden baslayip disarida birakilan surukleme
 *     tiklamayi pencereye verir, iptal sayilmamali).
 */

import type { DialogAction } from './Dialog';

/** Olay bu pencerenin kendisinde mi dogdu (icindeki pencereden gelmedi). */
export function isOwnEvent(target: EventTarget | null, currentTarget: EventTarget): boolean {
  return target === currentTarget;
}

/**
 * Tiklamada yapilacak is: onay turunde karartmaya (pencere ogesinin kendisine;
 * icerik kutuyu kaplar) basilip birakilmissa iptal; pasifse, basma kutunun
 * icindeyse ya da baska turse hicbir sey.
 */
export function backdropAction(
  confirm: boolean,
  pressedOnBackdrop: boolean,
  target: EventTarget | null,
  currentTarget: EventTarget,
  escape: DialogAction | undefined,
): (() => void) | undefined {
  if (!confirm || !pressedOnBackdrop || !isOwnEvent(target, currentTarget)) {
    return undefined;
  }
  return escape === undefined || escape.disabled === true ? undefined : escape.onAction;
}

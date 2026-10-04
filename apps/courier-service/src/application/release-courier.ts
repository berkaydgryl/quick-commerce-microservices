/**
 * Use-case: siparisi tasiyan kuryeyi bosa cikarir (BUSY -> IDLE).
 *
 * TEKRAR GUVENLIDIR: siparisi tasiyan kurye yoksa (zaten birakildi ya da hic
 * atanmadi) hata degil "birakilmadi" doner. Order, atamadan sonra siparisi
 * yazamazsa (bu arada iptal edildi) kuryeyi bununla geri verir; teslimat
 * kapanisi (T13.x) da ayni yolu kullanir.
 */

import type { Logger } from '@getir/core';

import type { CourierRepository } from '../domain/courier-repository.js';

export interface CourierRelease {
  readonly released: boolean;
  /** Birakilan kurye; released = false ise yok. */
  readonly courierId?: string;
}

export type ReleaseCourier = (orderId: string, logger: Logger) => Promise<CourierRelease>;

export function createReleaseCourier(repository: CourierRepository): ReleaseCourier {
  return async (orderId, logger) => {
    const released = await repository.releaseByOrder(orderId);
    if (released === null) {
      logger.info({ orderId }, 'birakilacak kurye yok (zaten birakilmis ya da atanmamis)');
      return { released: false };
    }
    logger.info({ orderId, courierId: released.id }, 'kurye birakildi');
    return { released: true, courierId: released.id };
  };
}

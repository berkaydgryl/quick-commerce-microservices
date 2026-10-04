/**
 * Kurye secim kurali (roadmap "Kurye Simulatoru"): bugun bilincli olarak
 * basit, "marketin en uzun suredir bos kuryesi". Akilli atama (mesafe, yuk
 * dengesi) bu arayuzun arkasina yeni bir uygulama olarak gelir; use-case
 * degismez.
 *
 * Her uygulama ATOMIK olmak zorundadir (B7): sec ve isaretle tek adimdir, iki
 * siparis ayni kuryeyi alamaz.
 */

import type { Courier, GeoPoint } from './courier.js';

export interface AssignmentRequest {
  readonly orderId: string;
  readonly marketId: string;
  /** Bugunku kural kullanmaz; mesafeye bakan kural ve rota (T13.2) icin. */
  readonly deliveryLocation: GeoPoint;
  readonly at: Date;
}

export interface AssignmentStrategy {
  /** Gunlukte gorunen ad. */
  readonly name: string;
  /**
   * Uygun kuryeyi siparise baglar; yoksa null.
   * @throws AppError CONFLICT: siparise baska bir kurye zaten bagli.
   */
  claim(request: AssignmentRequest): Promise<Courier | null>;
}

/**
 * Kurye secim kurali arayuzu (roadmap "Kurye Simulatoru"). Bugunku uygulama
 * havuzdan en yakin dilimde en uzun suredir bos kurye (T13.2,
 * application/nearest-available.ts). Baska kural (yuk dengesi, ETA) bu
 * arayuzun arkasina yeni bir uygulama olarak gelir; use-case degismez.
 *
 * Her uygulama ATOMIK olmak zorundadir (B7): iki siparis ayni kuryeyi alamaz.
 */

import type { Courier, GeoPoint } from './courier.js';

export interface AssignmentRequest {
  readonly orderId: string;
  /** Siparisin marketinin konumu (markets kopyasindan). */
  readonly marketLocation: GeoPoint;
  /** Bugunku kural kullanmaz; rota (T13.2 PR 3) icin. */
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

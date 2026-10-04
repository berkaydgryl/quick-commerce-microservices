/**
 * courier-svc PORTU (T13.1 PR 2): siparise kurye atama ve atamayi geri alma.
 * Uygulamasi infrastructure/courier'da (gRPC); testlerde sahtesi verilir.
 *
 * Ikisi de TEKRAR GUVENLIDIR (courier-svc): ayni siparise ikinci atama ayni
 * kuryeyi doner, tasiyan kurye yoksa birakma "birakilmadi" der.
 *
 * Uygun kurye olmamasi HATA DEGILDIR (proto AssignCourierResponse): null doner,
 * siparis kuryesiz PREPARING'de bekler. Hata firlatan durumlar: courier-svc'ye
 * ulasilamamasi (SERVICE_UNAVAILABLE), eszamanli atamanin kazanani o arada
 * birakildi (CONFLICT) ve gecersiz istek.
 */

import type { DeliveryLocation } from '../domain/order.js';
import type { RequestScope } from './request-scope.js';

export interface CourierAssignmentRequest {
  readonly orderId: string;
  /** Siparisin marketi (ADR-15); hangi kuryenin secilecegi courier-svc'nin kuralidir. */
  readonly marketId: string;
  readonly deliveryLocation: DeliveryLocation;
}

export interface AssignedCourier {
  readonly courierId: string;
}

export interface CourierAssignment {
  /** Siparise kurye atar; markette bos kurye yoksa null. */
  assign(request: CourierAssignmentRequest, scope: RequestScope): Promise<AssignedCourier | null>;
  /** Siparisi tasiyan kuryeyi bosa cikarir; tasiyan yoksa false. */
  release(orderId: string, scope: RequestScope): Promise<boolean>;
}

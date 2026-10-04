/**
 * Sahte courier servisi (T13.1 PR 2): courier-svc'nin kurallari bellekte
 * (assign-courier.ts, release-courier.ts):
 *   - markette bos kurye varsa siparise baglanir, yoksa null (NOT_FOUND);
 *   - ayni siparise ikinci istek AYNI kuryeyi doner (tekrar guvenli);
 *   - birakma siparisin kuryesini bosa cikarir, tasiyan yoksa false.
 * Cagrilar kaydedilir; hata ve "atama ucusta" senaryolari disaridan kurulur.
 */

import type { AppError } from '@getir/core';

import type {
  AssignedCourier,
  CourierAssignment,
  CourierAssignmentRequest,
} from '../../src/application/courier-assignment.js';
import type { RequestScope } from '../../src/application/request-scope.js';

export interface RecordedRelease {
  readonly orderId: string;
  readonly released: boolean;
}

export class FakeCourierAssignment implements CourierAssignment {
  readonly assignments: CourierAssignmentRequest[] = [];
  readonly releases: RecordedRelease[] = [];
  /** Her cagrinin istek kimligi, cagri sirasiyla. */
  readonly requestIds: string[] = [];
  /** Siparis -> tasiyan kurye (courier-svc'nin currentOrderId'si). */
  readonly carrying = new Map<string, string>();
  /** Doluysa atama bu hatayla basarisiz olur (orn. SERVICE_UNAVAILABLE). */
  assignFailure: AppError | undefined;
  /** Doluysa birakma bu hatayla basarisiz olur. */
  releaseFailure: AppError | undefined;
  /**
   * Atama courier'da UYGULANMADAN once calisir: istek yolda, kurye henuz
   * baglanmadi (QA T3: bu arada gelen birakma bos doner).
   */
  beforeAssignApplies: ((orderId: string) => Promise<void>) | undefined;
  /** Kurye baglandiktan sonra, cevap order'a DONMEDEN once calisir. */
  beforeAssignReturns: ((orderId: string, courierId: string) => Promise<void>) | undefined;
  /** Market -> bos kuryeler (en uzun suredir bos olan basta). */
  private readonly idle = new Map<string, string[]>();
  private readonly marketOf = new Map<string, string>();

  /** Markete bos kurye ekler. */
  addIdle(marketId: string, ...courierIds: string[]): void {
    for (const courierId of courierIds) {
      this.marketOf.set(courierId, marketId);
    }
    this.idle.set(marketId, [...(this.idle.get(marketId) ?? []), ...courierIds]);
  }

  /** Marketin su an bos kuryeleri. */
  idleIn(marketId: string): readonly string[] {
    return this.idle.get(marketId) ?? [];
  }

  async assign(
    request: CourierAssignmentRequest,
    scope: RequestScope,
  ): Promise<AssignedCourier | null> {
    this.assignments.push(request);
    this.requestIds.push(scope.requestId);
    if (this.assignFailure !== undefined) {
      throw this.assignFailure;
    }
    await this.beforeAssignApplies?.(request.orderId);
    const existing = this.carrying.get(request.orderId);
    if (existing !== undefined) {
      return { courierId: existing };
    }
    const courierId = this.idle.get(request.marketId)?.shift();
    if (courierId === undefined) {
      return null;
    }
    this.carrying.set(request.orderId, courierId);
    await this.beforeAssignReturns?.(request.orderId, courierId);
    return { courierId };
  }

  release(orderId: string, scope: RequestScope): Promise<boolean> {
    this.requestIds.push(scope.requestId);
    if (this.releaseFailure !== undefined) {
      return Promise.reject(this.releaseFailure);
    }
    const courierId = this.carrying.get(orderId);
    if (courierId === undefined) {
      this.releases.push({ orderId, released: false });
      return Promise.resolve(false);
    }
    this.carrying.delete(orderId);
    const marketId = this.marketOf.get(courierId) ?? '';
    this.idle.set(marketId, [...(this.idle.get(marketId) ?? []), courierId]);
    this.releases.push({ orderId, released: true });
    return Promise.resolve(true);
  }
}

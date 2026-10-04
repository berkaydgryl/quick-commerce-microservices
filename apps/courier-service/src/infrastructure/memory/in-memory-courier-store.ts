/**
 * Bellek deposu: MOCK modu ve testler. Mongo uygulamasiyla AYNI sozlesmeden
 * gecer: sira (lastAssignedAt artan, hic atanmamis once, esitlikte kimlik) ve
 * "bir siparisi en fazla bir kurye tasir" kurali (Mongo'da benzersiz indeks,
 * burada acik denetim; ikisi de CONFLICT). Islemler senkron oldugu icin her
 * adim kendiliginden atomiktir.
 */

import { AppError } from '@getir/core';

import { COURIER_STATUS } from '../../domain/courier.js';
import type { Courier } from '../../domain/courier.js';
import type {
  ClaimRequest,
  CourierRepository,
  CourierSeedWriter,
} from '../../domain/courier-repository.js';

/** Hic atanmamis kurye en one: Mongo'da eksik alan tarihlerden once siralanir. */
const NEVER_ASSIGNED = Number.NEGATIVE_INFINITY;

function assignmentOrder(left: Courier, right: Courier): number {
  const leftAt = left.lastAssignedAt?.getTime() ?? NEVER_ASSIGNED;
  const rightAt = right.lastAssignedAt?.getTime() ?? NEVER_ASSIGNED;
  if (leftAt !== rightAt) {
    return leftAt < rightAt ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export class InMemoryCourierStore implements CourierRepository, CourierSeedWriter {
  private readonly couriers = new Map<string, Courier>();

  constructor(initial: readonly Courier[] = []) {
    for (const courier of initial) {
      this.couriers.set(courier.id, courier);
    }
  }

  findById(id: string): Promise<Courier | null> {
    return Promise.resolve(this.couriers.get(id) ?? null);
  }

  findByOrder(orderId: string): Promise<Courier | null> {
    return Promise.resolve(this.carrierOf(orderId));
  }

  claimLeastRecentlyAssigned({ marketId, orderId, at }: ClaimRequest): Promise<Courier | null> {
    const candidate = [...this.couriers.values()]
      .filter((courier) => courier.marketId === marketId && courier.status === COURIER_STATUS.IDLE)
      .sort(assignmentOrder)[0];
    if (candidate === undefined) {
      return Promise.resolve(null);
    }
    if (this.carrierOf(orderId) !== null) {
      return Promise.reject(
        AppError.conflict('Kayit zaten var', { details: { fields: ['currentOrderId'] } }),
      );
    }
    const claimed: Courier = {
      ...candidate,
      status: COURIER_STATUS.BUSY,
      currentOrderId: orderId,
      lastAssignedAt: at,
    };
    this.couriers.set(claimed.id, claimed);
    return Promise.resolve(claimed);
  }

  releaseByOrder(orderId: string): Promise<Courier | null> {
    const carrier = this.carrierOf(orderId);
    if (carrier === null) {
      return Promise.resolve(null);
    }
    const { currentOrderId: _released, ...rest } = carrier;
    const released: Courier = { ...rest, status: COURIER_STATUS.IDLE };
    this.couriers.set(released.id, released);
    return Promise.resolve(released);
  }

  replaceAll(couriers: readonly Courier[]): Promise<void> {
    this.couriers.clear();
    for (const courier of couriers) {
      this.couriers.set(courier.id, courier);
    }
    return Promise.resolve();
  }

  private carrierOf(orderId: string): Courier | null {
    for (const courier of this.couriers.values()) {
      if (courier.currentOrderId === orderId) {
        return courier;
      }
    }
    return null;
  }
}

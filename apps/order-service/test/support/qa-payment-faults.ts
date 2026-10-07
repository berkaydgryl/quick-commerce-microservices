/**
 * QA (T15.3; #122, #124): payment-svc'nin gRPC isleyicilerine KAPILI ariza. Ariza yalnizca
 * kapilarla (Promise) kurulur; uyku ve zamanlayici yok:
 *
 *   holdReply  gercek isleyici TAMAMEN calisir, cevap kapi acilana kadar bekler. order'in sure
 *              siniri gercek saattir: order hata dondurunce test kapiyi acar (cevap iptal edilmis
 *              cagriya gider). Charge IDEMPOTENT oldugu icin cevabi dusurmek yetmez (cagri icinde
 *              tekrar eder ve ayni sonucu alir).
 *   dropReply  gercek isleyici calisir, cevap yerine SERVICE_UNAVAILABLE (NOT_IDEMPOTENT cagri).
 *   holdBefore isleyici kapi acilana kadar BASLAMAZ; varis `arrived` ile beklenir (yaris).
 *              `thenDrop` ile kapidan sonra islenir ama cevabi kaybolur.
 *   barrier    ilk n cagri birbirini bekler, hepsi gelince birlikte baslar (yaris).
 *   fail       isleyici calismaz, SERVICE_UNAVAILABLE; disarm edilene kadar (payment kapali).
 *
 * Isleyiciye ulasan her cagri sayilir (`calls`): senaryonun gercekten kuruldugunu kanitlar.
 * order tarafinda depo kancasi: FlakyPaidStore (siradaki PAID yazimi bir kez duser).
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import { toServiceError } from '@getir/service-kit';
import type { GrpcServiceRegistration } from '@getir/service-kit';
import type {
  sendUnaryData,
  ServerUnaryCall,
  ServiceError,
  UntypedServiceImplementation,
} from '@grpc/grpc-js';

import type { OrderEvent } from '../../src/domain/order-events.js';
import type { Order } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';

/** Elle acilan kapi; `opened` acilinca cozulur. */
export interface Gate {
  open(): void;
  readonly opened: Promise<void>;
}

export function gate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

export type PaymentRpc = 'charge' | 'confirm3Ds' | 'getPayment' | 'refund';

type Fault =
  | { readonly kind: 'hold-reply'; readonly gate: Gate }
  | { readonly kind: 'drop-reply' }
  | {
      readonly kind: 'hold-before';
      readonly gate: Gate;
      readonly arrival: Gate;
      readonly thenDrop: boolean;
    }
  | { readonly kind: 'barrier'; readonly size: number; readonly arrivals: Gate[] }
  | { readonly kind: 'fail' };

type Handler = (
  call: ServerUnaryCall<{ orderId?: string }, unknown>,
  callback: sendUnaryData<unknown>,
) => void;

const RPCS: readonly PaymentRpc[] = ['charge', 'confirm3Ds', 'getPayment', 'refund'];

const unavailable = (message: string): ServiceError =>
  toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, message));

export class PaymentFaults {
  private readonly faults = new Map<string, Fault>();
  private readonly counts = new Map<string, number>();

  /** Siradaki cagrinin cevabi kapi acilana kadar bekler (bir kez). */
  holdReply(rpc: PaymentRpc, orderId: string): Gate {
    const held = gate();
    this.faults.set(keyOf(rpc, orderId), { kind: 'hold-reply', gate: held });
    return held;
  }

  /** Siradaki cagri islenir, cevabi kaybolur (bir kez). */
  dropReply(rpc: PaymentRpc, orderId: string): void {
    this.faults.set(keyOf(rpc, orderId), { kind: 'drop-reply' });
  }

  /**
   * Siradaki cagri kapi acilana kadar baslamaz; `arrived` cagri isleyiciye ulasinca cozulur.
   * `thenDrop`: kapidan sonra islenir, cevabi kaybolur.
   */
  holdBefore(
    rpc: PaymentRpc,
    orderId: string,
    thenDrop = false,
  ): { readonly gate: Gate; readonly arrived: Promise<void> } {
    const held = gate();
    const arrival = gate();
    this.faults.set(keyOf(rpc, orderId), { kind: 'hold-before', gate: held, arrival, thenDrop });
    return { gate: held, arrived: arrival.opened };
  }

  /** Ilk `size` cagri birbirini bekler; hepsi gelince birlikte baslar. */
  barrier(rpc: PaymentRpc, orderId: string, size: number): void {
    this.faults.set(keyOf(rpc, orderId), { kind: 'barrier', size, arrivals: [] });
  }

  /** Cagrilar disarm edilene kadar SERVICE_UNAVAILABLE (payment kapali). */
  fail(rpc: PaymentRpc, orderId: string): void {
    this.faults.set(keyOf(rpc, orderId), { kind: 'fail' });
  }

  disarm(rpc: PaymentRpc, orderId: string): void {
    this.faults.delete(keyOf(rpc, orderId));
  }

  /** Isleyiciye ulasan cagri sayisi (ariza ne olursa olsun). */
  calls(rpc: PaymentRpc, orderId: string): number {
    return this.counts.get(keyOf(rpc, orderId)) ?? 0;
  }

  wrap(registration: GrpcServiceRegistration): GrpcServiceRegistration {
    const implementation: UntypedServiceImplementation = { ...registration.implementation };
    for (const rpc of RPCS) {
      const original = registration.implementation[rpc] as Handler;
      const faulty: Handler = (call, callback) => {
        const key = keyOf(rpc, call.request.orderId ?? '');
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        // Beklenmedik hata yutulmaz: cagri hatayla kapanir, test o hatayi gorur.
        this.handle(key, original, call, callback).catch((error: unknown) => {
          callback(unavailable(`QA ariza katmani: ${String(error)}`));
        });
      };
      implementation[rpc] = faulty as UntypedServiceImplementation[string];
    }
    return { ...registration, implementation };
  }

  private async handle(
    key: string,
    original: Handler,
    call: ServerUnaryCall<{ orderId?: string }, unknown>,
    callback: sendUnaryData<unknown>,
  ): Promise<void> {
    const fault = this.faults.get(key);
    if (fault === undefined) {
      original(call, callback);
      return;
    }
    switch (fault.kind) {
      case 'fail':
        callback(unavailable('QA: payment kapali'));
        return;
      case 'hold-before':
        this.faults.delete(key);
        fault.arrival.open();
        await fault.gate.opened;
        original(call, fault.thenDrop ? dropping(callback) : callback);
        return;
      case 'barrier': {
        const mine = gate();
        fault.arrivals.push(mine);
        if (fault.arrivals.length === fault.size) {
          this.faults.delete(key);
          for (const arrival of fault.arrivals) arrival.open();
        }
        await mine.opened;
        original(call, callback);
        return;
      }
      case 'drop-reply':
        this.faults.delete(key);
        original(call, dropping(callback));
        return;
      case 'hold-reply':
        this.faults.delete(key);
        original(call, (error, value, trailer, flags) => {
          if (error !== null) {
            callback(error);
            return;
          }
          // Iptal edilmis cagriya gec cevap: grpc-js yok sayar; hata olursa yutulur (cevap zaten kayip).
          fault.gate.opened
            .then(() => callback(error, value, trailer, flags))
            .catch(() => undefined);
        });
        return;
    }
  }
}

function keyOf(rpc: PaymentRpc, orderId: string): string {
  return `${rpc}:${orderId}`;
}

/** Isleyicinin basarili cevabini kaybeder (hatayi oldugu gibi iletir). */
function dropping(callback: sendUnaryData<unknown>): sendUnaryData<unknown> {
  return (error) => {
    callback(error ?? unavailable('QA: cevap kayboldu'));
  };
}

/** order deposu; isaretlenen siparisin SIRADAKI PAID yazimi bir kez duser (CONFLICT degil). */
export class FlakyPaidStore extends InMemoryOrderStore {
  private readonly failPaid = new Set<string>();

  failNextPaid(orderId: string): void {
    this.failPaid.add(orderId);
  }

  override update(
    order: Order,
    expectedVersion: number,
    events: readonly OrderEvent[],
  ): Promise<void> {
    if (order.status === ORDER_STATUS.PAID && this.failPaid.delete(order.id)) {
      return Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'QA: PAID yazilamadi'));
    }
    return super.update(order, expectedVersion, events);
  }
}

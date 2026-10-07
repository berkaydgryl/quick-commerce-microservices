/**
 * QA: gRPC isleyicilerine ariza enjeksiyonunun ORTAK cekirdegi. Iki kullanici:
 *   - qa-payment-faults.ts (T15.3): payment-svc'ye siparise gore kapili ariza;
 *   - devre kesici kanitlari (D17, #123): bagimli servise RPC basina davranis ve sunucuya ULASAN
 *     cagri sayaci. Devrenin acik oldugunun kaniti hiz degil, cagrinin aga gitmemesidir.
 *
 * Ariza yalnizca kapilarla (Promise) kurulur; uyku ve zamanlayici yok.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import type { ErrorCode } from '@getir/core';
import { toServiceError } from '@getir/service-kit';
import type { GrpcServiceRegistration } from '@getir/service-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type {
  sendUnaryData,
  ServerUnaryCall,
  ServiceDefinition,
  ServiceError,
  UntypedServiceImplementation,
} from '@grpc/grpc-js';

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

/** Bagimli servis "ulasilamaz": devre kesicinin saydigi tek hata sinifi. */
export function unavailable(message: string): ServiceError {
  return toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, message));
}

export type UnaryHandler = (
  call: ServerUnaryCall<unknown, unknown>,
  callback: sendUnaryData<unknown>,
) => void;

/** Kaydin verilen RPC'lerini (verilmezse hepsini) sarar: (ad, asil isleyici) -> yeni isleyici. */
export function wrapHandlers(
  registration: GrpcServiceRegistration,
  wrap: (rpc: string, original: UnaryHandler) => UnaryHandler,
  only?: readonly string[],
): GrpcServiceRegistration {
  const implementation: UntypedServiceImplementation = { ...registration.implementation };
  for (const rpc of only ?? Object.keys(registration.implementation)) {
    const original = registration.implementation[rpc] as UnaryHandler;
    implementation[rpc] = wrap(rpc, original) as UntypedServiceImplementation[string];
  }
  return { ...registration, implementation };
}

/** Tanimdan, her cagriya BOS cevap veren sahte servis (yalnizca devre kesici kanitlari icin). */
export function stubRegistration(
  name: string,
  definition: ServiceDefinition,
): GrpcServiceRegistration {
  const implementation: UntypedServiceImplementation = {};
  for (const rpc of Object.keys(definition)) {
    const answer: UnaryHandler = (_call, callback) => callback(null, {});
    implementation[rpc] = answer as UntypedServiceImplementation[string];
  }
  return { name, definition, implementation };
}

/**
 * RPC'nin davranisi:
 *   pass        asil isleyici calisir;
 *   unavailable SERVICE_UNAVAILABLE (devre kesici bunu sayar);
 *   business    is hatasi (servis CALISIYOR; devre kesici saymaz, sayaci sifirlar);
 *   hold        asil isleyici kapi acilana kadar BASLAMAZ (yari acik devrenin tek denemesi);
 *               `arrival` cagri isleyiciye ulasinca acilir (uykusuz bekleme);
 *   silent      cevap HIC gelmez: istemcinin sure siniri dolar (gercek ag arizasi, DEADLINE).
 */
export type Behavior =
  | { readonly kind: 'pass' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'business'; readonly error: AppError }
  | { readonly kind: 'hold'; readonly gate: Gate; readonly arrival: Gate }
  | { readonly kind: 'silent' };

export const PASS: Behavior = { kind: 'pass' };
export const SILENT: Behavior = { kind: 'silent' };

/** Is hatasi: servis CALISIYOR (devre kesici saymaz, ardisik sayaci sifirlar). */
export function businessError(code: ErrorCode): Behavior {
  return { kind: 'business', error: new AppError(code, 'QA: is hatasi') };
}

/** Kapida bekleyen davranis ve varis kapisi. */
export function hold(): {
  readonly behavior: Behavior;
  readonly release: Gate;
  readonly arrived: Promise<void>;
} {
  const release = gate();
  const arrival = gate();
  return { behavior: { kind: 'hold', gate: release, arrival }, release, arrived: arrival.opened };
}
export const UNAVAILABLE: Behavior = { kind: 'unavailable' };

/**
 * Bagimli servisin arizasi: RPC basina davranis ve isleyiciye ULASAN cagri sayaci. Sarilan
 * kayitta olmayan RPC adi hata verir: yanlis yazilmis ad sessizce "hic cagrilmadi" olmasin.
 */
export class DependencyFaults {
  private readonly behaviors = new Map<string, Behavior>();
  private readonly counts = new Map<string, number>();
  private readonly known = new Set<string>();

  set(rpc: string, behavior: Behavior): void {
    this.behaviors.set(this.checked(rpc), behavior);
  }

  /** Butun RPC'ler ayni davranis (bagimli servis tamamen dustu). */
  setAll(behavior: Behavior): void {
    this.fallback = behavior;
    this.behaviors.clear();
  }

  /** Her sey basa: butun RPC'ler gecer, sayaclar sifir (test basi). */
  reset(): void {
    this.behaviors.clear();
    this.counts.clear();
    this.fallback = PASS;
  }

  /** Isleyiciye ulasan cagri sayisi; rpc verilmezse butun RPC'ler. */
  calls(rpc?: string): number {
    if (rpc !== undefined) return this.counts.get(this.checked(rpc)) ?? 0;
    let total = 0;
    for (const count of this.counts.values()) total += count;
    return total;
  }

  wrap(registration: GrpcServiceRegistration): GrpcServiceRegistration {
    for (const rpc of Object.keys(registration.implementation)) this.known.add(rpc);
    return wrapHandlers(registration, (rpc, original) => (call, callback) => {
      this.counts.set(rpc, (this.counts.get(rpc) ?? 0) + 1);
      const behavior = this.behaviors.get(rpc) ?? this.fallback;
      switch (behavior.kind) {
        case 'pass':
          original(call, callback);
          return;
        case 'unavailable':
          callback(unavailable(`QA: ${rpc} ulasilamaz`));
          return;
        case 'business':
          callback(toServiceError(behavior.error));
          return;
        case 'hold':
          behavior.arrival.open();
          behavior.gate.opened.then(
            () => original(call, callback),
            () => callback(unavailable('QA: kapi')),
          );
          return;
        case 'silent':
          return;
      }
    });
  }

  private checked(rpc: string): string {
    if (this.known.size > 0 && !this.known.has(rpc)) {
      throw new Error(`QA: sarilan serviste RPC yok: ${rpc} (${[...this.known].join(', ')})`);
    }
    return rpc;
  }

  private fallback: Behavior = PASS;
}

export interface FaultyServer {
  readonly address: string;
  readonly faults: DependencyFaults;
  stop(): Promise<void>;
}

/** Arizali bir servisi port 0'da acar (asil kayit ya da stubRegistration). */
export async function startFaultyServer(
  registration: GrpcServiceRegistration,
): Promise<FaultyServer> {
  const faults = new DependencyFaults();
  const server = await startTestGrpcServer({
    serviceName: `qa-${registration.name}`,
    logger: silentLogger,
    services: [faults.wrap(registration)],
  });
  // Kapatma bir kez yapilir: test sunucuyu erken kapatabilir (kapali bagimli), temizlik yine cagirir.
  let stopping: Promise<void> | undefined;
  return {
    address: `127.0.0.1:${server.handle.port}`,
    faults,
    stop: () => (stopping ??= server.stop()),
  };
}

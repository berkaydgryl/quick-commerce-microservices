/**
 * gRPC sunucusunun dis yuzeyindeki tipler.
 *
 * NEDEN AYRI DOSYA: acilis (server.ts) ve kapanis (graceful-shutdown.ts) ayni
 * tipleri kullaniyor. Tipler ikisinden birinde dursaydi digeri ondan import
 * etmek zorunda kalir ve iki modul birbirine bagli hale gelirdi. Tip dosyasi
 * hicbir seye bagli olmadigi icin bu dugumu bastan cozer.
 */

import type { ServiceDefinition, UntypedServiceImplementation } from '@grpc/grpc-js';

import type { HealthRegistry } from '../health/registry.js';
import type { Logger } from '../logger.js';

/** Sunucuya baglanacak tek bir servis. */
export interface GrpcServiceRegistration {
  /** Uretilen (ts-proto) ya da yuklenen servis tanimi. */
  readonly definition: ServiceDefinition;
  /** RPC adlarindan handler'lara esleme. */
  readonly implementation: UntypedServiceImplementation;
  /**
   * Tam nitelikli servis adi (orn. "getir.catalog.v1.CatalogService").
   * Verilirse health tablosuna ayri bir satir olarak yazilir; boylece
   * gateway tek tek servis bazinda da durum sorabilir.
   */
  readonly name?: string;
}

export interface GrpcServerOptions {
  /** Kisa servis adi; gunluk alani ve acilis kaydi icin (orn. "catalog"). */
  readonly serviceName: string;
  /** Dinlenecek port. 0 verilirse isletim sistemi bos bir port secer (testler). */
  readonly port: number;
  readonly host?: string;
  readonly services: readonly GrpcServiceRegistration[];
  readonly logger?: Logger;
  /** Devam eden cagrilar icin beklenecek en uzun sure (ms). */
  readonly shutdownTimeoutMs?: number;
  /** Sunucu kapandiktan SONRA calisir: Mongo/Redis baglantilarini kapatir. */
  readonly onShutdown?: () => Promise<void> | void;
}

export interface GrpcServerHandle {
  /** Gercekten baglanilan port (port 0 verildiginde isletim sisteminin sectigi). */
  readonly port: number;
  /** Durum tablosu; servis kendi bagimliliklarina gore guncelleyebilir. */
  readonly health: HealthRegistry;
  /** Zarif kapanis. Birden cok kez cagrilabilir; ilk cagri disindakiler ayni sozu bekler. */
  shutdown(reason: string): Promise<void>;
}

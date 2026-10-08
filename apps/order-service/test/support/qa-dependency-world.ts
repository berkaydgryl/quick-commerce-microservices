/**
 * QA (D17; bekleyen is 123): order'in GERCEK sureci (dist/main.js, MOCK=true: bellek deposu,
 * olay yayini kapali) ve bagimlilari. Bagimlilar test surecinde GERCEK servis (catalog, risk,
 * payment, inventory, courier bellek kipinde); onlerinde ariza katmani (qa-grpc-faults.ts).
 * Devrenin kaniti iki yerden okunur:
 *   - bagimlinin isleyicisine ULASAN cagri sayisi (devre acikken artmaz);
 *   - surecin /metrics'i: grpc_client_breaker_state{target} (0 kapali, 1 yari acik, 2 acik) ve
 *     grpc_client_breaker_rejected_total{target}.
 * Surec baslatici inventory'nin QA yardimcisindan (startProcess; ortaklasmasi bekleyen is #106).
 * CI'da `pnpm build` entegrasyon testlerinden once kosar; yerelde once derleyin.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { silentLogger } from '@getir/core';
import { METRICS_PATH } from '@getir/observability';
import { orderV1 } from '@getir/proto';
import { CLIENT_METRICS, METRICS_PORT_OFFSET } from '@getir/service-kit';
import { unaryCall } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';
import { Client, credentials } from '@grpc/grpc-js';
import type { MethodDefinition } from '@grpc/grpc-js';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { buildCatalogService } from '../../../catalog-service/src/bootstrap.js';
import { buildCourierService } from '../../../courier-service/src/bootstrap.js';
import { buildInventoryService } from '../../../inventory-service/src/bootstrap.js';
import {
  startProcess,
  stopAllProcesses,
} from '../../../inventory-service/test/support/qa-inventory-process.js';
import type { RunningProcess } from '../../../inventory-service/test/support/qa-inventory-process.js';
import { buildPaymentService } from '../../../payment-service/src/bootstrap.js';
import { PendingRecords } from '../../../risk-service/src/application/pending-records.js';
import { buildRiskService } from '../../../risk-service/src/bootstrap.js';
import type { Dependency } from '../../src/infrastructure/grpc-resilience.js';
import { startFaultyServer } from './qa-grpc-faults.js';
import type { FaultyServer } from './qa-grpc-faults.js';

const ORDER_MAIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
const ORDER_READY = 'siparis servisi hazir';
/** Metrik okuma siniri: donmus surec P5'in bekleme butcesini asmasin, acik hata versin. */
const SCRAPE_TIMEOUT_MS = 2_000;
/**
 * grpc_client_breaker_state degerleri. service-kit'te BREAKER_STATE_VALUE (client-metrics.ts)
 * paketin disina acik degil; QA src'ye dokunmaz, metrigin sozlesmesi burada yazilir.
 */
export const BREAKER = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 } as const;

export type Dependencies = Readonly<Record<Dependency, FaultyServer>>;

/** Bes bagimli GERCEK servis (bellek kipi), arizali sunucu olarak: dosya basina bir kez. */
export function useDependencies(): () => Dependencies {
  let started: Dependencies | undefined;
  beforeAll(async () => {
    if (!existsSync(ORDER_MAIN)) {
      throw new Error(`${ORDER_MAIN} yok: once "pnpm build" (CI'da entegrasyondan once kosar)`);
    }
    const results = await Promise.allSettled([
      startFaultyServer(buildCatalogService({ logger: silentLogger })),
      startFaultyServer(
        buildRiskService({ logger: silentLogger, pendingRecords: new PendingRecords() }),
      ),
      startFaultyServer(buildPaymentService({ logger: silentLogger })),
      startFaultyServer(buildInventoryService({ logger: silentLogger })),
      startFaultyServer(buildCourierService({ logger: silentLogger })),
    ]);
    const servers = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    // Biri acilmazsa acilanlar kapanir: dosya acik sunucularla takilmasin, asil hata gorunsun.
    if (failed !== undefined) {
      await Promise.allSettled(servers.map((server) => server.stop()));
      throw new Error('bagimlilar acilamadi', { cause: failed.reason });
    }
    const [catalog, risk, payment, inventory, courier] = servers;
    if (!catalog || !risk || !payment || !inventory || !courier) throw new Error('bagimli eksik');
    started = { catalog, risk, payment, inventory, courier };
  });
  afterEach(async () => {
    await stopAllProcesses();
    for (const server of Object.values(started ?? {})) server.faults.reset();
  });
  afterAll(async () => {
    await Promise.allSettled(Object.values(started ?? {}).map((server) => server.stop()));
  });
  return () => {
    if (started === undefined) throw new Error('bagimlilar henuz acilmadi');
    return started;
  };
}

export interface OrderProcess {
  readonly process: RunningProcess;
  call<TRequest, TResponse>(
    method: MethodDefinition<TRequest, TResponse>,
    request: TRequest,
  ): Promise<CallResult<TResponse>>;
  /** Devre durumu ve reddedilen cagri sayisi, hedef basina (metrikte yoksa undefined). */
  breakers(): Promise<Readonly<Record<string, { state?: number; rejected?: number }>>>;
}

/** order'in gercek sureci (MOCK=true), bagimlilari arizali sunuculara bagli. Test sonunda kapanir. */
export async function startOrder(dependencies: Dependencies): Promise<OrderProcess> {
  const process = await startProcess({
    entry: ORDER_MAIN,
    readyMessage: ORDER_READY,
    portEnv: 'ORDER_GRPC_PORT',
    env: {
      MOCK: 'true',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      CATALOG_GRPC_ADDR: dependencies.catalog.address,
      RISK_GRPC_ADDR: dependencies.risk.address,
      PAYMENT_GRPC_ADDR: dependencies.payment.address,
      INVENTORY_GRPC_ADDR: dependencies.inventory.address,
      COURIER_GRPC_ADDR: dependencies.courier.address,
    },
  });
  if (!process.ready) throw new Error(`order acilmadi:\n${process.output()}`);
  const client = new Client(`127.0.0.1:${process.port}`, credentials.createInsecure());
  process.child.once('exit', () => client.close());
  return {
    process,
    call: (method, request) => unaryCall(client, method, request),
    breakers: async () => parseBreakers(await scrape(process.port + METRICS_PORT_OFFSET)),
  };
}

async function scrape(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${METRICS_PATH}`, {
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`metrik okunamadi: ${response.status} ${body.slice(0, 200)}`);
  return body;
}

/**
 * Prometheus metninden devre gostergeleri: `ad{target="x",service="order"} deger`. Etiket sirasi
 * ve varsayilan etiketler (service) kayitcinin isi; hedef etiketler arasindan okunur.
 */
function parseBreakers(text: string): Record<string, { state?: number; rejected?: number }> {
  const result: Record<string, { state?: number; rejected?: number }> = {};
  const pattern = /^(\w+)\{([^}]*)\} (\S+)$/gm;
  for (const [, name, labels, value] of text.matchAll(pattern)) {
    const target = /(?:^|,)target="([^"]+)"/.exec(labels ?? '')?.[1];
    if (target === undefined || value === undefined) continue;
    const entry = (result[target] ??= {});
    if (name === CLIENT_METRICS.BREAKER_STATE) entry.state = Number(value);
    if (name === CLIENT_METRICS.BREAKER_REJECTED) entry.rejected = Number(value);
  }
  return result;
}

export const orderService = orderV1.OrderServiceService;

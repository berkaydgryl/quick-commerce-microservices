/**
 * QA kara kutu dunyasi (T13.1 PR 2): order'in kurye iscisi GERCEK courier-svc'ye
 * GERCEK gRPC ile baglanir. courier-svc surec icinde kendi deposuyla
 * (buildCourierService), order kendi deposuyla ve uretimdeki istemci ayarlariyla
 * (GrpcCourierAssignment + D17 devre ve yeniden deneme) acilir. Backend testlerinde
 * courier sahtedir; burada courier'in kendi kurallari (B7, tekrar guvenligi) calisir.
 *
 * Courier modeline (market bagi, konum) dokunan TEK yer `placeCouriers`: kuryeler
 * siparisin marketinin konumuna yerlestirilir. T13.2'de kurye havuzu (marketin
 * cevresindeki bos kuryeler) gelince yalnizca burasi degisir; testler "markete N
 * kurye" ya da "baska marketin kuryesi alinmaz" varsaymaz.
 *
 * Courier'in durumu courier'in kendi RPC'siyle (GetCourier) okunur; order'in durumu
 * order'in deposundan.
 */

import { createServer } from 'node:net';

import { AppError, ERROR_CODES, ID_PREFIX, newId, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import type { Clock, Logger, MutableClock } from '@getir/core';
import { courierV1 } from '@getir/proto';
import { METRICS_PORT_OFFSET, startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { unaryCall } from '@getir/service-kit/testing';
import { Client, credentials } from '@grpc/grpc-js';

import { MARKETS } from '../../../catalog-service/src/infrastructure/fixtures/markets.js';
import { buildCourierService } from '../../../courier-service/src/bootstrap.js';
import type { Courier } from '../../../courier-service/src/domain/courier.js';
import type {
  CourierRepository,
  NearestClaimRequest,
} from '../../../courier-service/src/domain/courier-repository.js';
import { courierFromSeed } from '../../../courier-service/src/domain/courier-seed.js';
import type { MarketLocator } from '../../../courier-service/src/domain/market-locator.js';
import type { RouteRepository } from '../../../courier-service/src/domain/route-repository.js';
import { createDispatchCouriers } from '../../src/application/dispatch-couriers.js';
import type { DispatchRound } from '../../src/application/dispatch-couriers.js';
import { startCourierDispatching } from '../../src/bootstrap.js';
import {
  COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  COURIER_CALL_TIMEOUT_MS,
  COURIER_DISPATCH_BATCH_SIZE,
  COURIER_RETRY_DELAY_MS,
} from '../../src/config/constants.js';
import { applyRiskDecision, decideRisk } from '../../src/domain/checkout-risk.js';
import { queuedForCourier } from '../../src/domain/courier-dispatch.js';
import { orderCreatedEvents, statusChangedEvents } from '../../src/domain/order-events.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { GrpcCourierAssignment } from '../../src/infrastructure/courier/grpc-courier-assignment.js';
import { DEPENDENCY, dependencyResilience } from '../../src/infrastructure/grpc-resilience.js';
import type { OrderStore } from '../../src/infrastructure/order-store.js';
import type { CourierDispatcher } from '../../src/interfaces/workers/courier-dispatcher.js';
import { insertPaid, SAMPLE_RESERVATION_TTL_MS, sampleDraftInput } from './order-builders.js';

/** Testlerin sabit "simdi"si: siparisler ve kuryeler bu anda baslar. */
export const QA_NOW_MS = Date.parse('2026-10-04T12:00:00.000Z');

const LOCALHOST = '127.0.0.1';
const EPHEMERAL_PORT = 0;

/** Katalogun demo marketi (konumuyla): siparisler burada, kuryeler bu konumda. */
export const QA_MARKET = marketById('mkt_migros-jet-moda');

function marketById(id: string): {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
} {
  const market = MARKETS.find((candidate) => candidate.id === id);
  if (market === undefined) throw new Error(`katalogda ${id} yok`);
  return { id: market.id, lat: market.lat, lng: market.lng };
}

/** Teslimat adresi: marketin yakininda (Kadikoy). */
export const QA_DELIVERY = { lat: 40.9885, lng: 29.0262 } as const;

/**
 * Siparisin marketinin konumunda `count` bos kurye. Adlar ayirt edici: gunlukte
 * aranir (kisisel veri).
 */
export function placeCouriers(count: number, at: Date = new Date(QA_NOW_MS)): Courier[] {
  const tag = newId(ID_PREFIX.EVENT).slice(-6);
  return Array.from({ length: count }, (_, index) =>
    courierFromSeed(
      {
        id: newId(ID_PREFIX.COURIER),
        name: `Qakurye${tag}${index + 1} T.`,
        location: { lat: QA_MARKET.lat, lng: QA_MARKET.lng },
      },
      at,
    ),
  );
}

/**
 * courier deposunun etrafina kanca: courier-svc'nin KENDI kodu calisir, test yalnizca
 * zamanlamayi kurar (atama ucustayken iptal, cevabi kaybolan atama, yavas courier,
 * birakma aninda depo yok).
 */
export class HookedCourierRepository implements CourierRepository {
  /** Atama uygulanmadan ONCE (istek courier'da, kurye henuz baglanmadi). */
  beforeClaim: ((request: NearestClaimRequest) => Promise<void>) | undefined;
  /** Kurye baglandiktan SONRA, cevap order'a donmeden once. */
  afterClaim: ((claimed: Courier | null) => Promise<void>) | undefined;
  /** Doluysa birakma bu hatayla duser (courier'in deposu o an yok). */
  releaseFailure: AppError | undefined;

  constructor(private readonly inner: CourierRepository) {}

  findById(id: string): Promise<Courier | null> {
    return this.inner.findById(id);
  }

  findByOrder(orderId: string): Promise<Courier | null> {
    return this.inner.findByOrder(orderId);
  }

  async claimNearest(request: NearestClaimRequest): Promise<Courier | null> {
    await this.beforeClaim?.(request);
    const claimed = await this.inner.claimNearest(request);
    await this.afterClaim?.(claimed);
    return claimed;
  }

  releaseByOrder(orderId: string, at: Date): Promise<Courier | null> {
    if (this.releaseFailure !== undefined) {
      return Promise.reject(this.releaseFailure);
    }
    return this.inner.releaseByOrder(orderId, at);
  }
}

/** Surec icindeki courier-svc: gercek gRPC sunucusu ve ona bagli istemci. */
export interface QaCourierService {
  readonly address: string;
  readonly port: number;
  get(courierId: string): Promise<courierV1.Courier | undefined>;
  release(orderId: string): Promise<courierV1.ReleaseCourierResponse | undefined>;
  /** Siparisin rotasi (T13.2 PR 3): courier'in kendi RPC'siyle. */
  startRoute(orderId: string, courierId: string): Promise<courierV1.StartRouteResponse | undefined>;
  /** Yalnizca sunucuyu kapatir (courier "coktu"); istemci acik kalir. */
  stop(): Promise<void>;
}

/** Courier'i bos bir SABIT portta acar: coktukten sonra ayni adreste yeniden acilabilir. */
export const FREE_FIXED_PORT = 'bos-sabit-port';

export async function startCourierService(options: {
  readonly repository: CourierRepository;
  /** Market kopyasi ve rotalar (T13.2): verilmezse courier'in bellek varsayilanlari. */
  readonly markets?: MarketLocator;
  readonly routes?: RouteRepository;
  readonly clock: Clock;
  readonly logger?: Logger;
  /**
   * Verilirse bu portta acilir (coken courier'i ayni adreste yeniden acmak icin);
   * FREE_FIXED_PORT ise bos bir sabit port secilir (sonradan `port` ile yeniden acilir).
   */
  readonly port?: number | typeof FREE_FIXED_PORT;
}): Promise<QaCourierService> {
  const serve = (port: number): Promise<GrpcServerHandle> =>
    startGrpcServer({
      serviceName: 'courier-qa',
      host: LOCALHOST,
      port,
      services: [
        buildCourierService({
          couriers: options.repository,
          ...(options.markets === undefined ? {} : { markets: options.markets }),
          ...(options.routes === undefined ? {} : { routes: options.routes }),
          clock: options.clock,
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        }),
      ],
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
  const handle =
    options.port === FREE_FIXED_PORT
      ? await onFreeFixedPort(serve)
      : await serve(options.port ?? EPHEMERAL_PORT);
  const address = `${LOCALHOST}:${handle.port}`;
  const client = new Client(address, credentials.createInsecure());
  const service = courierV1.CourierServiceService;
  let stopped = false;
  return {
    address,
    port: handle.port,
    get: async (courierId) =>
      (await unaryCall(client, service.getCourier, { courierId })).response?.courier,
    release: async (orderId) =>
      (await unaryCall(client, service.releaseCourier, { orderId })).response,
    startRoute: async (orderId, courierId) =>
      (await unaryCall(client, service.startRoute, { orderId, courierId })).response,
    // Iki kez cagrilabilir: test courier'i "cokertir", temizlik yine kapatir.
    stop: async () => {
      if (stopped) return;
      stopped = true;
      client.close();
      await handle.shutdown('test');
    },
  };
}

/**
 * Sabit portun araligi isletim sisteminin gecici (ephemeral) araliginin ALTINDA:
 * Docker'in rastgele host portlari ve giden baglantilar oradan alinir; eski
 * 20000-60000 araligi onlarla cakisiyordu (#135 CI, EADDRINUSE). Taban Linux
 * varsayilani 32768 (GitHub runner'i varsayilanla gelir; macOS 49152'den baslar).
 * Metrik portu (gRPC + METRICS_PORT_OFFSET) da tabanin altinda kalir. Aralik
 * cakisma OLASILIGINI dusurur; kalan yaris icin ilk acilis yeni portla tekrar dener.
 */
const EPHEMERAL_FLOOR = 32_768;
const FIXED_PORT_MIN = 10_000;
const FIXED_PORT_SPAN = EPHEMERAL_FLOOR - METRICS_PORT_OFFSET - FIXED_PORT_MIN;
const FIXED_PORT_TRIES = 50;
/** Bos gorulen port sunucu baglanana kadar baskasina gecebilir (TOCTOU): yeni portla tekrar. */
const FIXED_PORT_START_ATTEMPTS = 5;
const PORT_IN_USE = 'EADDRINUSE';

/**
 * Courier'i "cokertip" AYNI adreste yeniden acmak icin bos port: hem gRPC portu hem
 * metrik portu bos olmali. Isletim sisteminin sectigi port (0) metrik sinirini
 * asabildigi icin aralik icinden rastgele denenir.
 */
async function freeFixedPort(): Promise<number> {
  for (let attempt = 0; attempt < FIXED_PORT_TRIES; attempt += 1) {
    const port = FIXED_PORT_MIN + Math.floor(Math.random() * FIXED_PORT_SPAN);
    if ((await isFree(port)) && (await isFree(port + METRICS_PORT_OFFSET))) {
      return port;
    }
  }
  throw new Error('bos port bulunamadi');
}

/**
 * Bos sabit portta acar: port arada baskasina gectiyse (EADDRINUSE) YALNIZCA
 * sunucuyu yeni portla yeniden acar (depo ve seed tekrarlanmaz). Ayni adreste
 * yeniden acilis (coken courier geri gelir) portu degistiremez; ona tekrar yok.
 */
async function onFreeFixedPort<T>(serve: (port: number) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await serve(await freeFixedPort());
    } catch (error: unknown) {
      const inUse = error instanceof Error && error.message.includes(PORT_IN_USE);
      if (!inUse || attempt === FIXED_PORT_START_ATTEMPTS) throw error;
    }
  }
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    const busy = (): void => resolve(false);
    probe.once('error', busy);
    probe.listen(port, LOCALHOST, () => {
      probe.off('error', busy);
      probe.close(() => resolve(true));
    });
  });
}

/** Order tarafi: servisin deposu + uretimdeki courier istemcisi. */
export interface QaOrderSide {
  readonly store: OrderStore;
  readonly clock: MutableClock;
  /** Iscinin TEK turu (zamanlayicisiz). */
  tour(): Promise<DispatchRound>;
  /** Uretimdeki isci (zamanlayiciyla). */
  startWorker(intervalMs: number): CourierDispatcher;
  /** Odenmis siparis (QA_MARKET, QA_DELIVERY). */
  paid(overrides?: Parameters<typeof insertPaid>[2]): Promise<Order>;
  /** Kimligi verilen odenmis siparis: kuyrukta nerede duracagi testte bilinsin. */
  paidAs(orderId: string, overrides?: Parameters<typeof insertPaid>[2]): Promise<Order>;
  order(orderId: string): Promise<Order | null>;
  close(): void;
}

export function orderSide(options: {
  readonly store: OrderStore;
  readonly courierAddress: string;
  readonly clock: MutableClock;
  readonly logger: Logger;
  /** Verilmezse uretimdeki sure; zaman asimi sinamayan testte yuklu makine icin genis. */
  readonly courierCallTimeoutMs?: number;
}): QaOrderSide {
  const courier = new GrpcCourierAssignment(
    options.courierAddress,
    options.courierCallTimeoutMs ?? COURIER_CALL_TIMEOUT_MS,
    dependencyResilience(DEPENDENCY.COURIER, options.logger),
  );
  const dispatch = createDispatchCouriers({
    awaiting: options.store.awaitingCourier,
    repository: options.store.repository,
    courier,
    clock: options.clock,
    batchSize: COURIER_DISPATCH_BATCH_SIZE,
    retryDelayMs: COURIER_RETRY_DELAY_MS,
    writeAttempts: COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  });
  return {
    store: options.store,
    clock: options.clock,
    tour: () => dispatch(options.logger),
    startWorker: (intervalMs) =>
      startCourierDispatching({
        awaiting: options.store.awaitingCourier,
        repository: options.store.repository,
        courier,
        logger: options.logger,
        clock: options.clock,
        intervalMs,
      }),
    paid: (overrides = {}) =>
      insertPaid(options.store.repository, options.clock, {
        marketId: QA_MARKET.id,
        deliveryLocation: QA_DELIVERY,
        ...overrides,
      }),
    paidAs: (orderId, overrides = {}) =>
      insertPaidAs(options.store.repository, options.clock, orderId, {
        marketId: QA_MARKET.id,
        deliveryLocation: QA_DELIVERY,
        ...overrides,
      }),
    order: (orderId) => options.store.repository.findById(orderId),
    close: () => courier.close(),
  };
}

/** insertPaid'in aynisi, kimlik disaridan (order-builders.ts insertPaid adimlari, #92 kuyruk ani dahil). */
async function insertPaidAs(
  repository: Pick<OrderRepository, 'insert' | 'update'>,
  clock: Clock,
  orderId: string,
  overrides: Parameters<typeof insertPaid>[2],
): Promise<Order> {
  const draft: Order = {
    ...createDraftOrder(sampleDraftInput(overrides), clock),
    id: orderId,
    reservation: {
      reservedAt: clock.date(),
      expiresAt: new Date(clock.now() + SAMPLE_RESERVATION_TTL_MS),
    },
  };
  await repository.insert(draft, orderCreatedEvents(draft));
  const awaiting = applyRiskDecision(draft, RISK_BANDS.LOW, decideRisk(RISK_BANDS.LOW), clock);
  // Odeme adimi gibi (payment-step markPaid): kurye kuyruguna odeme aniyla girer (#92).
  const paid = queuedForCourier(transitionOrder(awaiting, ORDER_STATUS.PAID, clock));
  await repository.update(paid, draft.version, statusChangedEvents(draft, paid));
  return paid;
}

/**
 * Testin actigi kapi: courier'in isi test izin verene kadar bekler. Sabit uyku
 * (sure + pay) yuk altinda istemcinin sure zamanlayicisiyla yarisir; kapi ise
 * order'in suresinin ONCE dolmasini garanti eder.
 */
export interface Gate {
  /** Kapi acilana kadar bekler. */
  pass(): Promise<void>;
  open(): void;
  /** Su an kapida bekleyen is sayisi. */
  readonly waiting: number;
}

export function gate(): Gate {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = 0;
  return {
    pass: async () => {
      waiting += 1;
      try {
        await opened;
      } finally {
        waiting -= 1;
      }
    },
    open: () => release(),
    get waiting() {
      return waiting;
    },
  };
}

/** Kosul saglanana kadar bekler (kisa araliklarla); saglanmazsa false. */
export async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(20);
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Courier ile order AYNI seyi mi soyluyor? Her BUSY kuryenin currentOrderId'si o
 * kuryeyi tasiyan siparistir; kuryesi yazilmis her siparisin kuryesi BUSY ve o
 * siparise bagli. Uyusmazliklari doner (bos = tutarli).
 */
export async function crossCheck(
  courierService: QaCourierService,
  couriers: readonly Courier[],
  orders: readonly Order[],
): Promise<string[]> {
  const problems: string[] = [];
  const byCourier = new Map<string, Order>();
  for (const order of orders) {
    if (order.courier === undefined) continue;
    const other = byCourier.get(order.courier.courierId);
    if (other !== undefined) problems.push(`${order.courier.courierId} iki sipariste`);
    byCourier.set(order.courier.courierId, order);
  }
  for (const placed of couriers) {
    const state = await courierService.get(placed.id);
    const holder = byCourier.get(placed.id);
    const busy = state?.status === courierV1.CourierStatus.COURIER_STATUS_BUSY;
    if (holder !== undefined && (!busy || state?.currentOrderId !== holder.id)) {
      problems.push(
        `${placed.id}: siparis ${holder.id} diyor, courier ${state?.currentOrderId ?? '-'}`,
      );
    }
    if (holder === undefined && busy) {
      problems.push(
        `${placed.id}: courier BUSY (${state?.currentOrderId ?? '-'}) ama siparis bilmiyor`,
      );
    }
  }
  return problems;
}

export const isBusy = (courier: courierV1.Courier | undefined): boolean =>
  courier?.status === courierV1.CourierStatus.COURIER_STATUS_BUSY;

/** Courier'in deposu o an yok: SERVICE_UNAVAILABLE (mongo-kit'in cevirdigi gibi). */
export function storeUnavailable(): AppError {
  return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Veritabanina ulasilamiyor');
}

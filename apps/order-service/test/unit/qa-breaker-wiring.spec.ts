/**
 * QA (D17; bekleyen is 123): order'in gRPC istemcilerinde devre kesici KABLOLAMASI. Her satir
 * gercek istemci + uretimdeki dependencyResilience, port 0'da sahte servis (tanimdan; davranisi
 * RPC basina, qa-grpc-faults.ts). Devrenin acik oldugunun kaniti HIZ degil: cagri sunucuya
 * ULASMAZ (sunucu tarafi sayac artmaz). Eski testler (kapali port, "durum kapali") kesici hic
 * takili olmasa da geciyordu.
 *
 *   W1 her RPC (14): esik dolunca sonraki cagri sunucuya gitmez, "devre disi" ile doner.
 *   W2 her bagimli: is hatasi devreyi ACMAZ ve ardisik sayaci SIFIRLAR; ayni testte devrenin
 *      gercekten acilabildigi de gorulur (iki yonlu kanit).
 *   W3 bagimli basina TEK devre: bir RPC'nin arizasi ayni istemcinin diger RPC'sini de keser.
 *   W4 yari acik (saat enjekte, uyku yok): sure dolunca TEK deneme gider; eszamanli ikincisi
 *      gitmez; basari kapatir, ariza yeniden acar.
 *   W5 gercek ag arizasi (x-app-error yok): cevap vermeyen bagimli (sure asimi) ve kapali
 *      bagimli (baglanti reddi) da devreyi acar.
 */

import { AppError, ERROR_CODES, fixedClock, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { catalogV1, courierV1, inventoryV1, paymentV1, riskV1 } from '@getir/proto';
import { CircuitBreaker } from '@getir/service-kit';
import type { ServiceDefinition } from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEPENDENCY_BREAKER_FAILURE_THRESHOLD,
  DEPENDENCY_BREAKER_OPEN_MS,
  IDEMPOTENT_RETRY_MAX,
} from '../../src/config/constants.js';
import { PAYMENT_METHOD } from '../../src/domain/checkout-payment.js';
import { RELEASE_REASON } from '../../src/domain/stock-reservation.js';
import { GrpcCatalogPricing } from '../../src/infrastructure/catalog/grpc-catalog-pricing.js';
import { GrpcCourierAssignment } from '../../src/infrastructure/courier/grpc-courier-assignment.js';
import { DEPENDENCY, dependencyResilience } from '../../src/infrastructure/grpc-resilience.js';
import type { ClientResilience, Dependency } from '../../src/infrastructure/grpc-resilience.js';
import { GrpcStockReservations } from '../../src/infrastructure/inventory/grpc-stock-reservations.js';
import { GrpcPayments } from '../../src/infrastructure/payment/grpc-payments.js';
import { GrpcRiskAssessment } from '../../src/infrastructure/risk/grpc-risk-assessment.js';
import { FUNCTIONAL_TIMEOUT_MS } from '../support/held-replies.js';
import {
  businessError,
  hold,
  PASS,
  SILENT,
  startFaultyServer,
  stubRegistration,
  UNAVAILABLE,
} from '../support/qa-grpc-faults.js';
import type { FaultyServer } from '../support/qa-grpc-faults.js';

const scope = { requestId: 'req_qa_devre', logger: silentLogger };
const MARKET = 'mkt_migros-jet-moda';
const ORDER = `ord_${'d17'.padStart(32, '0')}`;
const USER = `usr_${'d17'.padStart(32, '0')}`;
const THRESHOLD = DEPENDENCY_BREAKER_FAILURE_THRESHOLD;
const BUSINESS = businessError(ERROR_CODES.NOT_FOUND);
/** W5 cevapsiz bagimli: cagri bu surede DEADLINE ile kesilir (tek deneme, tekrar sigmaz). */
const SILENT_TIMEOUT_MS = 150;

/** Bir istemcinin tek RPC'si (sunucudaki ad). */
interface Probe {
  invoke(): Promise<unknown>;
}
/** Istemcinin RPC'leri (sunucudaki adiyla) ve kapatma. */
interface Connected {
  readonly rpcs: Readonly<Record<string, () => Promise<unknown>>>;
  close(): void;
}
type Open = (address: string, resilience: ClientResilience, timeoutMs: number) => Connected;

interface Dependent {
  readonly definition: ServiceDefinition;
  readonly open: Open;
}

const DEPENDENTS: Record<Dependency, Dependent> = {
  catalog: {
    definition: catalogV1.CatalogServiceService,
    open: (address, resilience, timeoutMs) => {
      const client = new GrpcCatalogPricing(address, timeoutMs, resilience);
      return {
        rpcs: {
          getMarket: () => client.marketRules(MARKET, scope),
          batchGetOffers: () => client.activeOffers(MARKET, ['prd_01'], scope),
        },
        close: () => client.close(),
      };
    },
  },
  risk: {
    definition: riskV1.RiskServiceService,
    open: (address, resilience, timeoutMs) => {
      const client = new GrpcRiskAssessment(address, timeoutMs, resilience);
      return {
        rpcs: {
          evaluate: () =>
            client.evaluate(
              {
                userId: USER,
                orderId: ORDER,
                marketId: MARKET,
                deliveredOrderCount: 0,
                cancelledOrderCount: 0,
                basketTotalMinor: 7_990,
                currency: 'TRY',
                checkoutDwellMs: 45_000,
                deliveryLocation: { lat: 40.99, lng: 29.02 },
                signals: {},
              },
              scope,
            ),
        },
        close: () => client.close(),
      };
    },
  },
  payment: {
    definition: paymentV1.PaymentServiceService,
    open: (address, resilience, timeoutMs) => {
      const client = new GrpcPayments(address, timeoutMs, resilience);
      return {
        rpcs: {
          charge: () =>
            client.charge(
              {
                orderId: ORDER,
                userId: USER,
                amountMinor: 7_990,
                currency: 'TRY',
                method: PAYMENT_METHOD.CARD,
                cardToken: 'tok_test_4242',
                idempotencyKey: `charge-${ORDER}`,
                requireThreeDs: false,
              },
              scope,
            ),
          confirm3Ds: () =>
            client.confirmThreeDs({ orderId: ORDER, challengeId: 'tds_1', code: '123456' }, scope),
          refund: () =>
            client.refund(
              { orderId: ORDER, reason: 'order_cancelled', idempotencyKey: `refund-${ORDER}` },
              scope,
            ),
          getPayment: () => client.getPayment(ORDER, scope),
        },
        close: () => client.close(),
      };
    },
  },
  inventory: {
    definition: inventoryV1.InventoryServiceService,
    open: (address, resilience, timeoutMs) => {
      const client = new GrpcStockReservations(address, timeoutMs, resilience);
      const order = { orderId: ORDER, marketId: MARKET };
      return {
        rpcs: {
          reserve: () =>
            client.reserve(
              { ...order, userId: USER, lines: [{ sku: 'SUT-1L', quantity: 1 }], ttlSeconds: 600 },
              scope,
            ),
          commit: () => client.commit(order, scope),
          release: () => client.release({ ...order, reason: RELEASE_REASON.USER_CANCELLED }, scope),
          extendReservation: () =>
            client.extend(
              {
                ...order,
                additionalSeconds: 60,
                expectedExpiresAt: new Date('2026-10-07T12:00:00Z'),
              },
              scope,
            ),
          shortenReservation: () => client.shorten({ ...order, maxRemainingSeconds: 120 }, scope),
        },
        close: () => client.close(),
      };
    },
  },
  courier: {
    definition: courierV1.CourierServiceService,
    open: (address, resilience, timeoutMs) => {
      const client = new GrpcCourierAssignment(address, timeoutMs, resilience);
      return {
        rpcs: {
          assignCourier: () =>
            client.assign(
              { orderId: ORDER, marketId: MARKET, deliveryLocation: { lat: 40.99, lng: 29.02 } },
              scope,
            ),
          releaseCourier: () => client.release(ORDER, scope),
        },
        close: () => client.close(),
      };
    },
  },
};

/** 14 RPC: istemcinin hangi cagrisi, sunucudaki adi, tekrar edilir mi (grpc-resilience.ts). */
const RPCS: readonly (readonly [Dependency, string, boolean])[] = [
  ['catalog', 'getMarket', true],
  ['catalog', 'batchGetOffers', true],
  ['risk', 'evaluate', false],
  ['payment', 'charge', true],
  ['payment', 'confirm3Ds', false],
  ['payment', 'refund', true],
  ['payment', 'getPayment', true],
  ['inventory', 'reserve', true],
  ['inventory', 'commit', true],
  ['inventory', 'release', true],
  ['inventory', 'extendReservation', true],
  ['inventory', 'shortenReservation', true],
  ['courier', 'assignCourier', true],
  ['courier', 'releaseCourier', true],
];

const opened: { server: FaultyServer; close: () => void }[] = [];
afterEach(async () => {
  // Biri kapanmazsa digerleri yine kapanir: dosyanin geri kalanina acik sunucu kalmasin.
  const closing = opened.splice(0).map(async ({ server, close }) => {
    close();
    await server.stop();
  });
  const failed = (await Promise.allSettled(closing)).find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed !== undefined) throw new Error('QA: sahte sunucu kapanmadi', { cause: failed.reason });
});

/** Bagimlinin sahte sunucusu ve uretim (ya da verilen) dayanikliligiyla istemcisi. */
async function connect(
  dependency: Dependency,
  resilience: ClientResilience = dependencyResilience(dependency, silentLogger),
  timeoutMs = FUNCTIONAL_TIMEOUT_MS,
) {
  const dependent = DEPENDENTS[dependency];
  const server = await startFaultyServer(stubRegistration(dependency, dependent.definition));
  const client = dependent.open(server.address, resilience, timeoutMs);
  opened.push({ server, close: () => client.close() });
  const probe = (rpc: string): Probe => {
    const invoke = client.rpcs[rpc];
    if (invoke === undefined) throw new Error(`istemcide RPC yok: ${dependency} ${rpc}`);
    return { invoke };
  };
  return { server, probe };
}

/** Cagrinin sonucu ne olursa olsun yakalanir (is hatasi istemcide null da olabilir). */
async function settle(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** Cagri AppError ile dusmeli (istemci gRPC hatasini AppError'a cevirir). */
async function failureOf(call: Promise<unknown>): Promise<AppError> {
  const error = await settle(call);
  if (!(error instanceof AppError)) throw new Error(`AppError bekleniyordu: ${String(error)}`);
  return error;
}

/** Basarisiz cagrinin sunucuya ulasan deneme sayisi: tekrar edilen 1 + IDEMPOTENT_RETRY_MAX. */
const attemptsOf = (idempotent: boolean) => (idempotent ? IDEMPOTENT_RETRY_MAX + 1 : 1);

/** Devreyi acar: esik kadar deneme sunucuya ulasir, fazlasi (tekrar) acik devreye takilir. */
async function trip(server: FaultyServer, probe: Probe, rpc: string, idempotent: boolean) {
  server.faults.set(rpc, UNAVAILABLE);
  const calls = Math.ceil(THRESHOLD / attemptsOf(idempotent));
  for (let n = 0; n < calls; n += 1) {
    expect(await failureOf(probe.invoke())).toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  }
  expect(server.faults.calls(rpc)).toBe(THRESHOLD);
}

/** Devre acik: cagri sunucuya ULASMADAN "devre disi" ile doner. */
async function expectBlocked(server: FaultyServer, probe: Probe): Promise<void> {
  const before = server.faults.calls();
  const error = await failureOf(probe.invoke());
  expect(error).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
  expect(error.message).toContain('devre disi');
  expect(server.faults.calls()).toBe(before);
}

describe('QA D17 W1: her RPC devre kesiciye bagli (esikten sonra cagri aga gitmez)', () => {
  it.each(RPCS)('%s %s (tekrar: %s)', async (dependency, rpc, idempotent) => {
    const { server, probe } = await connect(dependency);
    const call = probe(rpc);

    await trip(server, call, rpc, idempotent);

    await expectBlocked(server, call);
  });
});

describe('QA D17 W2: is hatasi devreyi acmaz, ardisik sayaci sifirlar (devre yine de acilabilir)', () => {
  it.each(
    Object.values(DEPENDENCY).map((target) => {
      const row = RPCS.find(([dependency]) => dependency === target);
      if (row === undefined) throw new Error(`satir yok: ${target}`);
      return row;
    }),
  )('%s %s', async (dependency, rpc, idempotent) => {
    const { server, probe } = await connect(dependency);
    const call = probe(rpc);
    const attempts = attemptsOf(idempotent);
    // Esigin hemen altinda kalacak kadar ulasilamaz cagri.
    const belowThreshold = Math.floor((THRESHOLD - 1) / attempts);
    // Kanitin on kosulu (sabitler degisirse bos kalmasin): tur bos degil ve sifirlama
    // olmasaydi iki tur esigi ASARDI, ikinci turun bir denemesi devreye takilirdi.
    expect(belowThreshold).toBeGreaterThan(0);
    expect(2 * belowThreshold * attempts).toBeGreaterThan(THRESHOLD);
    const failBelow = async () => {
      server.faults.set(rpc, UNAVAILABLE);
      for (let n = 0; n < belowThreshold; n += 1) {
        const before = server.faults.calls(rpc);
        await settle(call.invoke());
        expect(server.faults.calls(rpc) - before).toBe(attempts);
      }
    };

    server.faults.set(rpc, BUSINESS);
    for (let n = 0; n < THRESHOLD * 2; n += 1) await settle(call.invoke());
    expect(server.faults.calls(rpc)).toBe(THRESHOLD * 2);
    await failBelow();
    server.faults.set(rpc, BUSINESS);
    await settle(call.invoke());
    // Is hatasi sayaci sifirladi: ikinci tur da TAM ulasir (saysaydi devre acilirdi).
    await failBelow();

    // Iki yonlu kanit: devre bu istemcide gercekten acilabiliyor.
    server.faults.set(rpc, UNAVAILABLE);
    for (let n = 0; n <= THRESHOLD; n += 1) await settle(call.invoke());
    await expectBlocked(server, call);
  });
});

describe('QA D17 W3: bagimli basina tek devre (bir RPC acar, digerlerini de keser)', () => {
  it.each([
    ['catalog', 'getMarket', 'batchGetOffers'],
    ['payment', 'getPayment', 'charge'],
    ['inventory', 'commit', 'reserve'],
    ['courier', 'releaseCourier', 'assignCourier'],
  ] as const)('%s: %s acilinca %s de kesilir', async (dependency, failing, other) => {
    const { server, probe } = await connect(dependency);

    await trip(server, probe(failing), failing, true);

    server.faults.set(other, PASS);
    await expectBlocked(server, probe(other));
    expect(server.faults.calls(other)).toBe(0);
  });
});

describe('QA D17 W4: yari acik devre (saat enjekte)', () => {
  /**
   * Uretimin dayanikliligi (dependencyResilience), yalnizca devrenin saati sahte: acik kalma
   * suresi uykusuz gecer. dependencyResilience saat almaz (QA src'ye dokunmaz); devre ayni
   * uretim sabitleriyle kurulur, yeniden deneme uretimdekinin aynisidir.
   */
  const resilienceAt = (clock: MutableClock): ClientResilience => ({
    ...dependencyResilience(DEPENDENCY.PAYMENT, silentLogger),
    breaker: new CircuitBreaker({
      target: DEPENDENCY.PAYMENT,
      failureThreshold: THRESHOLD,
      openMs: DEPENDENCY_BREAKER_OPEN_MS,
      now: () => clock.now(),
    }),
  });

  it('sure dolunca TEK deneme gider, eszamanli ikincisi gitmez; basari devreyi kapatir', async () => {
    const clock = fixedClock(Date.parse('2026-10-07T12:00:00Z'));
    const { server, probe } = await connect('payment', resilienceAt(clock));
    const call = probe('getPayment');
    await trip(server, call, 'getPayment', true);
    await expectBlocked(server, call);

    clock.advance(DEPENDENCY_BREAKER_OPEN_MS);
    const held = hold();
    server.faults.set('getPayment', held.behavior);
    const trial = settle(call.invoke());
    await held.arrived;
    const reachedWithTrial = server.faults.calls('getPayment');
    // Deneme surerken ikinci cagri aga gitmez.
    await expectBlocked(server, call);
    expect(server.faults.calls('getPayment')).toBe(reachedWithTrial);
    held.release.open();
    await trial;

    // Basarili deneme devreyi kapatti: siradaki cagri sunucuya ulasir.
    server.faults.set('getPayment', PASS);
    await settle(call.invoke());
    expect(server.faults.calls('getPayment')).toBe(reachedWithTrial + 1);
  });

  it('deneme de duserse devre yeniden acilir', async () => {
    const clock = fixedClock(Date.parse('2026-10-07T12:00:00Z'));
    const { server, probe } = await connect('payment', resilienceAt(clock));
    const call = probe('getPayment');
    await trip(server, call, 'getPayment', true);

    clock.advance(DEPENDENCY_BREAKER_OPEN_MS);
    const before = server.faults.calls('getPayment');
    await settle(call.invoke());
    // Tek deneme gitti, dustu; tekrar acik devreye takildi.
    expect(server.faults.calls('getPayment')).toBe(before + 1);

    await expectBlocked(server, call);
  });
});

describe('QA D17 W5: gercek ag arizasi da devreyi acar (x-app-error yok)', () => {
  it('cevap vermeyen bagimli: her cagri sure asimiyla duser; esikten sonra sunucuya gitmez', async () => {
    const { server, probe } = await connect(
      'payment',
      dependencyResilience(DEPENDENCY.PAYMENT, silentLogger),
      SILENT_TIMEOUT_MS,
    );
    const call = probe('getPayment');
    server.faults.set('getPayment', SILENT);

    for (let n = 0; n < THRESHOLD; n += 1) {
      expect(await failureOf(call.invoke())).toMatchObject({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
      });
    }
    // Sure asimi butun sureyi yer: tekrar sigmaz, her cagri TEK kez ulasir.
    expect(server.faults.calls('getPayment')).toBe(THRESHOLD);

    await expectBlocked(server, call);
  });

  it('kapali bagimli: baglanti reddi esik kadar sayilir, sonraki cagri "devre disi"', async () => {
    const { server, probe } = await connect('risk');
    const call = probe('evaluate');
    // Sunucu ilk cagridan once kapanir: istemci hic baglanamaz (Evaluate tekrar edilmez).
    await server.stop();

    for (let n = 0; n < THRESHOLD; n += 1) {
      const refused = await failureOf(call.invoke());
      expect(refused).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
      expect(refused.message).not.toContain('devre disi');
    }

    const blocked = await failureOf(call.invoke());
    expect(blocked).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(blocked.message).toContain('devre disi');
  });
});

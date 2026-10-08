/**
 * QA rota testlerinin Mongo dunyasi (T13.2 PR 3, #174): dosya basina bir Mongo konteyneri, test
 * basina taze veritabani ve uretimdeki acilisla courier kopyalari (openCourierStore + gRPC). Konum
 * ve geometri yardimcilari #174 (yolda iptalde kurye anlik konumda bosa cikar) beklentileri icin.
 *
 * Kullanan: qa-route-mongo.spec.ts (Q1-Q5), qa-route-release.spec.ts (#174 kenarlari).
 */

import { ID_PREFIX, newId } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, afterEach, beforeAll } from 'vitest';

import {
  DEFAULT_COURIER_SPEED_KMH,
  DEFAULT_ORDER_PREP_SECONDS,
} from '../../src/config/constants.js';
import type { Courier, GeoPoint } from '../../src/domain/courier.js';
import { routeProgress } from '../../src/domain/route-progress.js';
import type { MovementRule } from '../../src/domain/route-progress.js';
import type { RouteRepository } from '../../src/domain/route-repository.js';
import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import { MARKET_LOCATION_SEEDS } from '../../src/infrastructure/fixtures/couriers.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { RouteDocument } from '../../src/infrastructure/mongo/documents.js';
import { CouriersCollection } from '../../src/infrastructure/mongo/couriers-collection.js';
import { fromRouteDocument } from '../../src/infrastructure/mongo/mappers.js';
import { MarketsCollection } from '../../src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../src/infrastructure/mongo/mongo-courier-seed-writer.js';
import { startQaCourierServer } from './qa-courier-harness.js';
import type { QaCourierServer } from './qa-courier-harness.js';

const MONGO_IMAGE = 'mongo:7';
/** Uretimdeki gibi sureli, yuklu makinede yanlis kirmizi vermesin diye genis. */
const STORE_TIMEOUT_MS = 10_000;
const EARTH_RADIUS_M = 6_378_100;
const DEGREE = Math.PI / 180;

/** Rotanin hareket kurali yoksa (#197 oncesi rota) kullanilan o anki ayar: harness varsayilani. */
export const CURRENT_MOVEMENT: MovementRule = {
  speedKmh: DEFAULT_COURIER_SPEED_KMH,
  prepSeconds: DEFAULT_ORDER_PREP_SECONDS,
};
/** Kurye hizi, metre/saniye (bagimsiz geometri denetimi icin). */
export const SPEED_MPS = (DEFAULT_COURIER_SPEED_KMH * 1_000) / 3_600;
/** Uretimin haversine'i ile testin duz izdusumu arasindaki fark payi (km olceginde), metre. */
export const GEO_TOLERANCE_M = 2;

/** distance_meters'tan istemcinin bulacagi ETA (B4: tek kaynak). */
export const clientEta = (distanceMeters: number, speedKmh = DEFAULT_COURIER_SPEED_KMH): number =>
  Math.ceil((distanceMeters * 3_600) / (speedKmh * 1_000));

/**
 * Testin bagimsiz uzaklik hesabi: duz (equirectangular) izdusum, uretimin haversine'inden FARKLI
 * yontem; km olceginde fark santimetreler.
 */
export function metersBetween(from: GeoPoint, to: GeoPoint): number {
  const x = (to.lng - from.lng) * DEGREE * Math.cos(((from.lat + to.lat) / 2) * DEGREE);
  const y = (to.lat - from.lat) * DEGREE;
  return EARTH_RADIUS_M * Math.hypot(x, y);
}

/** Iki nokta arasindaki dogru parcada, baslangictan `meters` uzaktaki nokta (duz izdusum). */
export function pointTowards(from: GeoPoint, to: GeoPoint, meters: number): GeoPoint {
  const share = meters / metersBetween(from, to);
  return {
    lat: from.lat + (to.lat - from.lat) * share,
    lng: from.lng + (to.lng - from.lng) * share,
  };
}

/** Kuryenin Mongo'daki son konumu ve ani, GetCourier'den (tel uzerinden). */
export async function lastLocationOf(
  service: QaCourierServer,
  holder: string,
): Promise<{ readonly location: GeoPoint; readonly at: Date | undefined }> {
  const courier = (await service.get(holder)).response?.courier;
  const location = courier?.lastLocation;
  if (location === undefined) throw new Error(`kurye konumu yok: ${holder}`);
  return { location: { lat: location.lat, lng: location.lng }, at: courier?.lastLocationAt };
}

export interface ReplicaOptions {
  readonly dbName: string;
  readonly clock: MutableClock;
  readonly name: string;
  readonly uri?: string;
  readonly operationTimeoutMs?: number;
  readonly lines?: LogLine[];
  /**
   * Rota adimini saran depo (Q2: rota adiminda Mongo donar). Verilirse birakma ve tick'in rota
   * deposu (movingRoutes) VERILMEZ: o kopyanin birakmasi rotayi bitirmez, konum hesaplamaz.
   */
  readonly wrapRoutes?: (routes: RouteRepository) => RouteRepository;
}

/** Dosyanin Mongo dunyasi: kancalari kaydeder, test basina kapanislari calistirir. */
export function useRouteWorld() {
  let container: StartedMongoDBContainer | undefined;
  let raw: MongoClient | undefined;
  const cleanups: (() => unknown)[] = [];

  const started = (): StartedMongoDBContainer => {
    if (container === undefined) throw new Error('Mongo yok');
    return container;
  };
  const client = (): MongoClient => {
    if (raw === undefined) throw new Error('Mongo istemcisi yok');
    return raw;
  };
  const directUri = (): string => `${started().getConnectionString()}/?directConnection=true`;

  beforeAll(async () => {
    container = await new MongoDBContainer(MONGO_IMAGE).start();
    raw = await MongoClient.connect(directUri());
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  afterAll(async () => {
    await raw?.close();
    await container?.stop();
  });

  const routesOf = (dbName: string) => client().db(dbName).collection<Document>(COLLECTIONS.ROUTES);
  const routeDocs = (dbName: string, order: string): Promise<Document[]> =>
    routesOf(dbName)
      .find({ _id: order } as Document)
      .toArray();

  return {
    container: started,
    raw: client,
    onCleanup: (cleanup: () => unknown) => cleanups.push(cleanup),
    freshDb: (): string => `qa_rota_${newId(ID_PREFIX.EVENT).slice(-8)}`,
    routesOf,
    routeDocs,
    couriersOf: (dbName: string) => client().db(dbName).collection<Document>(COLLECTIONS.COURIERS),

    /** Seed komutunun yaptigi: indeks, sonra kuryeler ve demo market kopyasi. */
    async seed(dbName: string, list: readonly Courier[]): Promise<void> {
      const connection: MongoConnection = await connectMongo({
        uri: directUri(),
        dbName,
        operationTimeoutMs: STORE_TIMEOUT_MS,
      });
      try {
        const couriers = new CouriersCollection(connection.db);
        await couriers.ensureIndexes();
        await new MongoCourierSeedWriter(
          connection,
          couriers,
          new MarketsCollection(connection.db),
        ).replaceAll(list, MARKET_LOCATION_SEEDS);
      } finally {
        await connection.close();
      }
    },

    /** Uretimdeki acilisla bir courier kopyasi (openCourierStore + gRPC sunucusu). */
    async replica(options: ReplicaOptions): Promise<QaCourierServer> {
      const logger = recordingLogger(options.lines ?? []);
      const store = await openCourierStore(
        {
          uri: options.uri ?? directUri(),
          dbName: options.dbName,
          serverSelectionTimeoutMs: 5_000,
          operationTimeoutMs: options.operationTimeoutMs ?? STORE_TIMEOUT_MS,
        },
        { logger, clock: options.clock },
      );
      cleanups.push(() => store.close());
      const server = await startQaCourierServer({
        repository: store.repository,
        markets: store.markets,
        routes: options.wrapRoutes === undefined ? store.routes : options.wrapRoutes(store.routes),
        // Uretimdeki main.ts gibi: birakma ve tick ayni Mongo rota deposunu okur (#174).
        ...(options.wrapRoutes === undefined ? { movingRoutes: store.routes } : {}),
        clock: options.clock,
        logger,
        name: options.name,
      });
      cleanups.push(() => server.stop());
      return server;
    },

    /** Rota belgesinin hareket kurali (#197): zaman varsayimlari ona dayanir. */
    async movementOf(dbName: string, order: string): Promise<unknown> {
      const [document] = await routeDocs(dbName, order);
      return document?.['movement'];
    },

    /** PM karari (#174): birakma anindaki konum = routeProgress(rota, o an); rota belgesinden. */
    async routePositionAt(dbName: string, order: string, atMs: number): Promise<GeoPoint> {
      const [document] = await routeDocs(dbName, order);
      if (document === undefined) throw new Error(`rota yok: ${order}`);
      const route = fromRouteDocument(document as unknown as RouteDocument);
      return routeProgress(route, new Date(atMs), CURRENT_MOVEMENT).position;
    },
  };
}

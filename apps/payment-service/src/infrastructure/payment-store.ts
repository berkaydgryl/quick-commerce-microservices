/**
 * Odeme deposunu ve kart kasasinin deposunu (T11.17) ACAR: MOCK=true -> bellek,
 * aksi halde Mongo (ikisi ayni baglanti ve ayni veritabani).
 *
 * Baglanmak, indeks kurmak ve hata olursa baglantiyi birakmak altyapi isidir;
 * bootstrap.ts'in tek isi parcalari BAGLAMAK (order-store.ts ile ayni ayrim).
 */

import type { Logger } from '@getir/core';
import { applyMigrations, connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { CardRepository } from '../domain/card-repository.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import { MIGRATIONS } from '../migrations/index.js';
import { InMemoryCardStore } from './memory/in-memory-card-store.js';
import { InMemoryPaymentStore } from './memory/in-memory-payment-store.js';
import { CardMongoStore } from './mongo/card-mongo-store.js';
import { CardWalletsCollection } from './mongo/card-wallets-collection.js';
import { CardsCollection } from './mongo/cards-collection.js';
import { PaymentMongoStore } from './mongo/payment-mongo-store.js';
import { PaymentsCollection } from './mongo/payments-collection.js';

export interface PaymentStore {
  readonly repository: PaymentRepository;
  /** Kart kasasi (T11.17): cards + card_wallets. */
  readonly cards: CardRepository;
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

export async function openPaymentStore(
  mongo: MongoEnv | undefined,
  logger: Logger,
): Promise<PaymentStore> {
  if (mongo === undefined) {
    return {
      repository: new InMemoryPaymentStore(),
      cards: new InMemoryCardStore(),
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const connection = await connectMongo({ ...mongo, appName: SERVICE_NAME, logger });

  const payments = new PaymentsCollection(connection.db);
  const cards = new CardsCollection(connection.db);
  const wallets = new CardWalletsCollection(connection.db);
  try {
    // Gocler indekslerden ONCE (T10.4, ADR-19): kod uygulanmamis semayla calismaz.
    await applyMigrations(connection, MIGRATIONS, logger);
    // Unique indeksler acilista kurulur: siparis basina tek odeme ve
    // idempotency ona dayanir; indekssiz calismak kurali sessizce kapatirdi.
    await payments.ensureIndexes();
    // Ayni kart kurali (kismi unique) ve kart sayaci acilista kurulur: sayac
    // koleksiyonu transaction icinde ortuk olusturmaya birakilmaz.
    await cards.ensureIndexes();
    await wallets.ensureCollection(connection.unbounded.db);
  } catch (error: unknown) {
    // Baglanti acik kalirsa process kapanmaz ve hata gizlenir.
    await connection.close();
    throw error;
  }

  return {
    repository: new PaymentMongoStore(payments),
    cards: new CardMongoStore(cards, wallets, connection),
    name: 'mongo',
    close: () => connection.close(),
  };
}

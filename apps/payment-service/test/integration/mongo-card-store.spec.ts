/**
 * Kart kasasinin Mongo uygulamasi - gercek Mongo (Testcontainers), T11.17.
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Sozlesme: bellek uygulamasiyla AYNI senaryolar gercek transaction'da;
 *      es zamanli eklemede sayac yarisi (QA P4).
 *   2. Acilis (servisin kendi acicisi, openPaymentStore): kismi unique indeks ve
 *      card_wallets koleksiyonu kurulu; ikinci acilis hata vermez.
 *   3. Ham belge (QA P2): number ve cvv alani yok, tam numara ve CVV hicbir
 *      alanda yok; saglayici jetonu cevaba cikmaz.
 *   4. Ret (P6) sayaci artirmaz; silme (P5) jetonu kaldirir, sayaci azaltir.
 *   5. gRPC uzerinden es zamanli AddCard: kasa siniri ve ayni kart (P4).
 */

import { CARD_FIELD_MESSAGES, SAVED_CARDS_MAX } from '@getir/contracts';
import { ERROR_CODES, silentLogger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { cardvaultV1 } from '@getir/proto';
import { appErrorOf, unaryCall } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CardRepository } from '../../src/domain/card-repository.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { CardDocument, CardWalletDocument } from '../../src/infrastructure/mongo/documents.js';
import { openPaymentStore } from '../../src/infrastructure/payment-store.js';
import type { PaymentStore } from '../../src/infrastructure/payment-store.js';
import { describeCardStoreContract } from '../support/card-store-contract.js';
import { startCardVault } from '../support/card-vault-grpc-client.js';
import type { RunningCardVault } from '../support/card-vault-grpc-client.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_payment_kasa_test';
const Vault = cardvaultV1.CardVaultServiceService;

let container: StartedMongoDBContainer;
let opened: PaymentStore;
let inspect: MongoConnection;
let vault: RunningCardVault;

/** Servisin kendi acilisi: goc, indeksler, card_wallets (uretimdeki gibi sureli). */
function open(): Promise<PaymentStore> {
  return openPaymentStore(
    {
      uri: `${container.getConnectionString()}?directConnection=true`,
      dbName: DB_NAME,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 2_000,
    },
    silentLogger,
  );
}

const cards = () => inspect.db.collection<CardDocument>(COLLECTIONS.CARDS);
const wallets = () => inspect.db.collection<CardWalletDocument>(COLLECTIONS.CARD_WALLETS);

let users = 0;
function newUser(): string {
  users += 1;
  return `usr_mongo-kasa-${users}`;
}

function addRequest(
  userId: string,
  overrides: Partial<cardvaultV1.AddCardRequest> = {},
): cardvaultV1.AddCardRequest {
  return {
    userId,
    number: '3782 822463 10005',
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: '9183',
    holderName: 'Ayşe Yılmaz',
    nickname: 'İş kartı',
    ...overrides,
  };
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  opened = await open();
  inspect = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
  });
  vault = await startCardVault({ repository: opened.cards }, 'kasa-int');
});

afterAll(async () => {
  await vault?.stop();
  await opened?.close();
  await inspect?.close();
  await container?.stop();
});

describeCardStoreContract('mongo', (): CardRepository => opened.cards);

describe('acilis', () => {
  it('cards indeksleri ve card_wallets koleksiyonu kurulu; ikinci acilis hata vermez', async () => {
    const second = await open();
    await second.close();

    const indexes = await cards().indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'userId_card_active_unique',
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        }),
        expect.objectContaining({ name: 'userId_status_createdAt' }),
      ]),
    );
    const collections = await inspect.db
      .listCollections({ name: COLLECTIONS.CARD_WALLETS }, { nameOnly: true })
      .toArray();
    expect(collections).toHaveLength(1);
  });
});

describe('ham belge ve sayac', () => {
  it('belgede number ve cvv alani yok; tam numara, ortasi ve CVV hicbir alanda yok (QA P2)', async () => {
    const userId = newUser();
    const { response } = await unaryCall(vault.client, Vault.addCard, addRequest(userId));
    const id = response?.card?.id ?? '';

    const document = await cards().findOne({ _id: id });

    expect(Object.keys(document ?? {}).sort()).toEqual(
      [
        '_id',
        'brand',
        'createdAt',
        'expiryMonth',
        'expiryYear',
        'first4',
        'holderName',
        'last4',
        'nickname',
        'providerToken',
        'status',
        'userId',
      ].sort(),
    );
    expect(document).toMatchObject({
      first4: '3782',
      last4: '0005',
      providerToken: 'tok_test_0005',
    });
    const raw = JSON.stringify(document);
    for (const secret of ['378282246310005', '822463', '9183']) {
      expect(raw).not.toContain(secret);
    }
    expect(JSON.stringify(response)).not.toContain('tok_test_0005');
    expect(await wallets().findOne({ _id: userId })).toMatchObject({ count: 1 });
  });

  it('saglayici reddinde kart yazilmaz, sayac artmaz (QA P6)', async () => {
    const userId = newUser();

    const { error } = await unaryCall(
      vault.client,
      Vault.addCard,
      addRequest(userId, { number: '4000 0000 0000 0002', cvv: '918' }),
    );

    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.PAYMENT_DECLINED);
    expect(await cards().countDocuments({ userId })).toBe(0);
    expect((await wallets().findOne({ _id: userId }))?.count ?? 0).toBe(0);
  });

  it('silme: jeton alani kaldirilir, deletedAt yazilir, sayac azalir; ayni kart yeniden eklenir (QA P5)', async () => {
    const userId = newUser();
    const { response } = await unaryCall(vault.client, Vault.addCard, addRequest(userId));
    const id = response?.card?.id ?? '';

    await unaryCall(vault.client, Vault.deleteCard, { userId, cardId: id });

    const deleted = await cards().findOne({ _id: id });
    expect(deleted).toMatchObject({ status: 'DELETED', deletedAt: expect.any(Date) as unknown });
    expect(deleted).not.toHaveProperty('providerToken');
    expect(await wallets().findOne({ _id: userId })).toMatchObject({ count: 0 });

    const again = await unaryCall(vault.client, Vault.addCard, addRequest(userId));
    expect(again.error).toBeUndefined();
    expect(await wallets().findOne({ _id: userId })).toMatchObject({ count: 1 });
  });
});

describe('gRPC uzerinden es zamanli AddCard (QA P4)', () => {
  it(`${SAVED_CARDS_MAX + 1} farkli kart ayni anda: ${SAVED_CARDS_MAX} kart, biri dolu kasa; sayac kartlarla esit`, async () => {
    const userId = newUser();

    const results = await Promise.all(
      Array.from({ length: SAVED_CARDS_MAX + 1 }, (_, index) =>
        unaryCall(vault.client, Vault.addCard, addRequest(userId, { expiryMonth: index + 1 })),
      ),
    );

    const failed = results.filter((result) => result.error !== undefined);
    expect(failed).toHaveLength(1);
    expect(appErrorOf(failed[0]?.error)?.details).toEqual({ cards: CARD_FIELD_MESSAGES.cards });
    expect(await cards().countDocuments({ userId, status: 'ACTIVE' })).toBe(SAVED_CARDS_MAX);
    expect(await wallets().findOne({ _id: userId })).toMatchObject({ count: SAVED_CARDS_MAX });
  });

  it('ayni karta ayni anda iki AddCard: tek kart; digeri CONFLICT ve kazananin kimligi', async () => {
    const userId = newUser();

    const [left, right] = await Promise.all([
      unaryCall(vault.client, Vault.addCard, addRequest(userId)),
      unaryCall(vault.client, Vault.addCard, addRequest(userId)),
    ]);

    const winner = left?.error === undefined ? left : right;
    const loser = left?.error === undefined ? right : left;
    expect(appErrorOf(loser?.error)).toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { cardId: winner?.response?.card?.id },
    });
    expect(await cards().countDocuments({ userId, status: 'ACTIVE' })).toBe(1);
    expect(await wallets().findOne({ _id: userId })).toMatchObject({ count: 1 });
  });
});

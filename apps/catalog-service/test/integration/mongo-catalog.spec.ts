/**
 * Katalogun Mongo uygulamasi - gercek Mongo (Testcontainers). ADR-15.
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Sozlesme testleri: bellek uygulamasiyla AYNI senaryolar gercek sorguda
 *      (kategori, market, teklif - her okuyucu kendi sozlesmesiyle).
 *   2. Seed: sayilar, tekrar kosunun kopya uretmemesi, indeksler, tek transaction.
 *   3. Pazaryeri: 3 demo adresi 2dsphere uzerinden beklenen marketleri listeler,
 *      kapali market listede kalir.
 *   4. Sorgu planlari: arama, genel arama ve toplu okuma indeksten okunur.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBatchGetOffers } from '../../src/application/batch-get-offers.js';
import { createListNearbyMarkets } from '../../src/application/list-nearby-markets.js';
import { createSearchNearby } from '../../src/application/search-nearby.js';
import { createSeedCatalog } from '../../src/application/seed-catalog.js';
import type { CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import type { NearbySearchResult } from '../../src/domain/nearby-search.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { OfferDocument } from '../../src/infrastructure/mongo/documents.js';
import type { MongoCatalogRepositories } from '../../src/infrastructure/mongo/mongo-catalog.js';
import {
  createMongoCatalogRepositories,
  ensureCatalogIndexes,
} from '../../src/infrastructure/mongo/mongo-catalog.js';
import { MongoCatalogSeeder } from '../../src/infrastructure/mongo/mongo-catalog-seeder.js';
import {
  listOffersFilter,
  offersByProductIdsFilter,
  searchActiveOffersPipeline,
} from '../../src/infrastructure/mongo/offer-repository.js';
import { describeCategoryReaderContract } from '../support/category-reader-contract.js';
import { CLASSIC_SNAPSHOT } from '../support/classic-catalog.js';
import {
  DEMO_ADDRESSES,
  demoLocation,
  EXPECTED_NEARBY,
  expectedNearbyCurrent,
  expectNearbyList,
} from '../support/demo-addresses.js';
import { describeMarketReaderContract } from '../support/market-reader-contract.js';
import { describeOfferReaderContract } from '../support/offer-reader-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_catalog_test';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let repositories: MongoCatalogRepositories;
let seeder: MongoCatalogSeeder;

/**
 * Davranis testleri KLASIK kumeyle kosar (classic-catalog.ts; bellek testleriyle
 * ayni senaryolar). Guncel demo verisinin Mongo'ya yuklendigini "seed" bolumu
 * ayrica dener.
 */
async function seed(snapshot: CatalogSnapshot = CLASSIC_SNAPSHOT): Promise<void> {
  await createSeedCatalog({ writer: seeder, snapshot, isProduction: false })();
}

/** Arama sonucunun karsilastirilan ozeti (Mongo ve bellek ayni olmali). */
function summary(result: NearbySearchResult) {
  return {
    marketId: result.market.market.id,
    meters: Math.round(result.market.distanceMeters),
    nameMatched: result.marketNameMatched,
    offerIds: result.offers.map((offer) => offer.id),
    total: result.totalOfferMatches,
  };
}

/** Mongo $geoNear mesafesi haversine'den en fazla 1 m sapar. */
const GEO_NEAR_TOLERANCE_METERS = 1;

async function countOf(name: string): Promise<number> {
  return connection.db.collection(name).countDocuments();
}

async function expectDemoCounts(): Promise<void> {
  expect(await countOf(COLLECTIONS.CATEGORIES)).toBe(13);
  expect(await countOf(COLLECTIONS.PRODUCTS)).toBe(49);
  expect(await countOf(COLLECTIONS.MARKETS)).toBe(21);
  expect(await countOf(COLLECTIONS.OFFERS)).toBe(CLASSIC_SNAPSHOT.offers.length);
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    // Uretimdeki gibi sureli (#51): toplu yazim ve transaction bu ayarla kosar.
    operationTimeoutMs: 2_000,
  });
  repositories = createMongoCatalogRepositories(connection.db);
  seeder = new MongoCatalogSeeder(connection, repositories);
  await ensureCatalogIndexes(repositories);
  await seed();
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describeCategoryReaderContract('mongo', () => repositories.categories);
describeMarketReaderContract('mongo', () => repositories.markets);
describeOfferReaderContract('mongo', () => repositories.offers);

describe('seed', () => {
  it('13 kategori, 49 urun, 21 market ve tum teklifler yuklu', async () => {
    await expectDemoCounts();
  });

  it('tekrar kosmak kopya uretmez', async () => {
    await seed();
    await seed();

    await expectDemoCounts();
  });

  it('bildirilen indeksler olusmus', async () => {
    const namesOf = async (name: string): Promise<string[]> =>
      (await connection.db.collection(name).indexes()).map((index) => index.name ?? '').sort();

    expect(await namesOf(COLLECTIONS.CATEGORIES)).toEqual(['_id_', 'slug_unique']);
    expect(await namesOf(COLLECTIONS.PRODUCTS)).toEqual(['_id_', 'sku_unique']);
    expect(await namesOf(COLLECTIONS.MARKETS)).toEqual(['_id_', 'location_2dsphere']);
    expect(await namesOf(COLLECTIONS.OFFERS)).toEqual([
      '_id_',
      'market_category_cursor',
      'market_cursor',
      'market_product_unique',
    ]);
  });

  it('eski dark store koleksiyonuna yazilmaz', async () => {
    const names = (await connection.db.listCollections().toArray()).map(
      (collection) => collection.name,
    );

    expect(names).not.toContain('darkstores');
  });

  it('benzersiz slug gercekten zorlanir (CONFLICT)', async () => {
    const duplicate = {
      id: 'cat_kopya',
      name: 'Kopya',
      slug: 'icecek',
      sortOrder: 9,
      imageUrl: '/img/x.png',
    };

    const failing = seeder.replaceAll({
      ...CATALOG_SNAPSHOT,
      categories: [...CATALOG_SNAPSHOT.categories, duplicate],
    });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('basarisiz seed HICBIR koleksiyonu degistirmez (tek transaction)', async () => {
    await expectDemoCounts();
  });

  it('ayni market-urun ikilisine ikinci teklif CONFLICT (market_product_unique)', async () => {
    const [first] = CATALOG_SNAPSHOT.offers;
    if (first === undefined) throw new Error('demo verisinde teklif yok');

    // Ayni ikili iki kez: turetilen _id de ayni oldugu icin cakisma zaten
    // _id'de yakalanir; indeks, kimlik bicimi degisse bile ikiliyi korur.
    const failing = seeder.replaceAll({
      ...CATALOG_SNAPSHOT,
      offers: [...CATALOG_SNAPSHOT.offers, first],
    });

    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    await expectDemoCounts();
  });

  it('olmayan urune isaret eden teklif: transaction baslamadan reddedilir, veri degismez (D7)', async () => {
    const failing = seeder.replaceAll({
      ...CATALOG_SNAPSHOT,
      offers: [
        ...CATALOG_SNAPSHOT.offers,
        { marketId: 'mkt_migros-jet-moda', productId: 'prd_yok', priceMinor: 100, isActive: true },
      ],
    });

    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
    await expectDemoCounts();
  });
});

describe('ListNearbyMarkets - gercek Mongo', () => {
  const listNearby = (): ReturnType<typeof createListNearbyMarkets> =>
    createListNearbyMarkets({ markets: repositories.markets });

  it('adres dosyasi sozlesmedeki savedAddressSchema ya (kayitli adres) uyar ve 3 tanedir', () => {
    expect(DEMO_ADDRESSES.map((address) => address.title)).toEqual(['Ev', 'İş', 'Yazlık']);
  });

  it.each(['Ev', 'İş', 'Yazlık'] as const)(
    '%s -> beklenen marketler, yakindan uzaga',
    async (title) => {
      expectNearbyList(
        await listNearby()(demoLocation(title)),
        EXPECTED_NEARBY[title],
        GEO_NEAR_TOLERANCE_METERS,
      );
    },
  );

  it('kapali market listede kalir (Is: A101 Abbasaga)', async () => {
    const nearby = await listNearby()(demoLocation('İş'));

    expect(nearby.find((entry) => entry.market.id === 'mkt_a101-abbasaga')?.market.isOpen).toBe(
      false,
    );
  });
});

/** explain() ciktisi dis veridir: zorlanmaz, semadan gecer; yalnizca KAZANAN plan okunur. */
const explainSchema = z.object({ queryPlanner: z.object({ winningPlan: z.unknown() }) });

/**
 * Kazanan plan agacindaki asamalar ve indeksler. Plan bicimi surumden surume
 * degisir (ic ice inputStage / inputStages); agac guvenli bicimde gezilir.
 * Reddedilen planlar (rejectedPlans) BILEREK okunmaz: indeksin orada gorunmesi
 * kullanildigi anlamina gelmez.
 */
function planStages(
  node: unknown,
  found: { stages: string[]; indexes: string[] } = { stages: [], indexes: [] },
) {
  if (Array.isArray(node)) {
    node.forEach((child) => planStages(child, found));
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'stage' && typeof value === 'string') found.stages.push(value);
      else if (key === 'indexName' && typeof value === 'string') found.indexes.push(value);
      else planStages(value, found);
    }
  }
  return found;
}

/** executionStats: kac belge incelendi, kac belge dondu. */
const executionSchema = z.object({
  queryPlanner: z.object({ winningPlan: z.unknown() }),
  executionStats: z.object({ nReturned: z.number(), totalDocsExamined: z.number() }),
});

describe('arama - gercek Mongo (T9.4)', () => {
  const MODA = 'mkt_migros-jet-moda';

  it('cok kelimeli arama market indeksinden okunur: koleksiyon taramasi yok, inceleme o marketin teklifleriyle sinirli', async () => {
    const offers = connection.db.collection<OfferDocument>(COLLECTIONS.OFFERS);
    const marketOffers = await offers.countDocuments({ marketId: MODA });
    // Deponun GERCEK filtresi ve siralamasi (listOffers ile ayni).
    const plan: unknown = await offers
      .find(listOffersFilter({ marketId: MODA, query: 'peynir beyaz' }))
      .sort({ _id: 1 })
      .limit(51)
      .explain('executionStats');

    const { queryPlanner, executionStats } = executionSchema.parse(plan);
    const { stages } = planStages(queryPlanner.winningPlan);
    expect(stages).toContain('IXSCAN');
    expect(stages).not.toContain('COLLSCAN');
    expect(executionStats.nReturned).toBe(1);
    expect(executionStats.totalDocsExamined).toBeLessThanOrEqual(marketOffers);
  });
});

/**
 * Toplama sorgusunun (aggregate) explain ciktisi. Kazanan plan surume ve
 * motora gore iki yerde durur: boru hatti sorgu katmanina tumuyle itilirse en
 * ustte, degilse ilk asamanin ($cursor) icinde. Ikisi de ayni semadan gecer.
 */
const aggregateExecutionSchema = z.union([
  executionSchema,
  z
    .object({ stages: z.tuple([z.object({ $cursor: executionSchema })]).rest(z.unknown()) })
    .transform(({ stages: [first] }) => first.$cursor),
]);

describe('genel arama - gercek Mongo (T9.6)', () => {
  /** offers koleksiyonunda marketId ile baslayan indeksler (OfferRepository.indexes). */
  const MARKET_PREFIXED_INDEXES = [
    'market_product_unique',
    'market_category_cursor',
    'market_cursor',
  ];

  it('boru hatti market indeksinden okunur: koleksiyon taramasi yok, inceleme o marketlerin teklifleriyle sinirli', async () => {
    const offers = connection.db.collection<OfferDocument>(COLLECTIONS.OFFERS);
    const marketIds = EXPECTED_NEARBY.Ev.map((entry) => entry.marketId);
    const marketOffers = await offers.countDocuments({ marketId: { $in: marketIds } });
    // Deponun GERCEK boru hatti (searchActiveOffers ile ayni).
    const plan: unknown = await offers
      .aggregate(searchActiveOffersPipeline(marketIds, 'süt', 3))
      .explain('executionStats');

    const { queryPlanner, executionStats } = aggregateExecutionSchema.parse(plan);
    const { stages, indexes } = planStages(queryPlanner.winningPlan);
    expect(stages).toContain('IXSCAN');
    expect(stages).not.toContain('COLLSCAN');
    // marketId ile baslayan uc indeksin maliyeti burada esit; planlayici birini
    // secer (mongo:7'de market_product_unique + kucuk SORT). Olculen ozellik
    // hangisi oldugu degil: yalnizca verilen marketlerin teklifleri okunur.
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.every((index) => MARKET_PREFIXED_INDEXES.includes(index))).toBe(true);
    expect(executionStats.totalDocsExamined).toBeLessThanOrEqual(marketOffers);
    expect(marketOffers).toBeLessThan(await offers.countDocuments());
  });

  it.each([
    ['Ev', 'süt'],
    ['Ev', 'su'],
    ['Ev', 'camasir'],
    ['Ev', 'migros'],
    ['İş', 'cips'],
    ['İş', 'a101'],
    ['Yazlık', 'süt'],
  ] as const)('%s "%s": bellek uygulamasiyla AYNI sonuc', async (title, query) => {
    const input = { location: demoLocation(title), query };

    const fromMongo = await createSearchNearby(repositories)(input);
    const fromMemory = await createSearchNearby(createInMemoryReaders(CLASSIC_SNAPSHOT))(input);

    expect(fromMongo.map(summary)).toEqual(fromMemory.map(summary));
  });
});

describe('BatchGetOffers - gercek Mongo (T9.3)', () => {
  it('deponun GERCEK filtresi market_product_unique ile okunur; kazanan planda koleksiyon taramasi yok', async () => {
    const plan: unknown = await connection.db
      .collection<OfferDocument>(COLLECTIONS.OFFERS)
      .find(
        offersByProductIdsFilter('mkt_migros-jet-moda', [
          'prd_sut-1l',
          'prd_kola-1l',
          'prd_elma-1k',
        ]),
      )
      .explain('queryPlanner');

    const { stages, indexes } = planStages(explainSchema.parse(plan).queryPlanner.winningPlan);
    expect(stages).toContain('IXSCAN');
    expect(stages).not.toContain('COLLSCAN');
    expect(indexes).toEqual(['market_product_unique']);
  });

  it('15 urunluk Migros sepeti tek cagrida: 14 satilabilir, pasif camasir suyu missing', async () => {
    const productIds = (
      await repositories.offers.listOffers(
        { marketId: 'mkt_migros-jet-moda' },
        { size: 50, token: '' },
      )
    ).items.map((offer) => offer.product.id);
    const batch = createBatchGetOffers({
      offers: repositories.offers,
      markets: repositories.markets,
    });

    const result = await batch({ marketId: 'mkt_migros-jet-moda', productIds });

    expect(productIds).toHaveLength(15);
    expect(result.offers).toHaveLength(14);
    expect(result.missing).toEqual(['prd_camasir-suyu']);
  });
});

describe('GUNCEL demo verisi - gercek Mongo (07.10 cesitliligi)', () => {
  beforeAll(async () => {
    await seed(CATALOG_SNAPSHOT);
  });

  afterAll(async () => {
    // Bu dosyanin diger bolumleri klasik kumeyi bekler.
    await seed();
  });

  it('yuklenir: butun urun, market ve teklifler; benzersiz indeks ihlali yok', async () => {
    expect(await countOf(COLLECTIONS.CATEGORIES)).toBe(CATALOG_SNAPSHOT.categories.length);
    expect(await countOf(COLLECTIONS.PRODUCTS)).toBe(CATALOG_SNAPSHOT.products.length);
    expect(await countOf(COLLECTIONS.MARKETS)).toBe(CATALOG_SNAPSHOT.markets.length);
    expect(await countOf(COLLECTIONS.OFFERS)).toBe(CATALOG_SNAPSHOT.offers.length);
  });

  it.each(['Ev', 'İş', 'Yazlık'] as const)(
    '%s: $geoNear klasik listeyi aynen basta, yeni subeleri sonda verir',
    async (title) => {
      expectNearbyList(
        await createListNearbyMarkets({ markets: repositories.markets })(demoLocation(title)),
        expectedNearbyCurrent(title),
        GEO_NEAR_TOLERANCE_METERS,
      );
    },
  );

  it.each([
    ['Ev', 'şeker'],
    ['Ev', 'çay'],
    ['Ev', 'yoğurt'],
    ['Ev', 'bim'],
    ['İş', 'su'],
    ['İş', 'kedi'],
  ] as const)(
    '%s "%s": bellek uygulamasiyla AYNI sonuc (yeni Turkce adlar)',
    async (title, query) => {
      const input = { location: demoLocation(title), query };

      const fromMongo = await createSearchNearby(repositories)(input);
      const fromMemory = await createSearchNearby(createInMemoryReaders())(input);

      expect(fromMongo.map(summary)).toEqual(fromMemory.map(summary));
      expect(fromMongo.length).toBeGreaterThan(0);
    },
  );
});

/**
 * QA kara kutu (T15.2, catalog geriye donuk PR 1; CQ2): genel arama (SearchNearby) gercek
 * katalogla (fixture: 122 urun, 33 market, 1505 teklif) GERCEK Mongo'da. Kahin iki yonlu: elle
 * yazilmis beklentiler ve bellek uygulamasiyla FARK karsilastirmasi (ayni istek iki uygulamada
 * birebir ayni cevap; Mongo regex'le, bellek dize aramasiyla calisir).
 *
 *   A1 Turkce katlama: "süt", "SÜT", "sut" ayni sonuc; "TEREYAĞI" / "tereyagi"; "ÇİKOLATA" /
 *      "cikolata"; kelime ICINDE ("kolata"); kelime sirasi onemsiz ("kıyma dana").
 *   A2 regex ozel karakterleri literal: ".*", "((", "[a-z]", "\\", "$$", "^s", ")(" hata vermez,
 *      bellekle ayni; ".*" hicbir teklifle eslesmez.
 *   A3 uzunluk siniri (kirpildiktan sonra 2-64): iki yani, bosluklu sorgu kirpilir.
 *   A4 sonuc kurallari: market basina en fazla SEARCH_RESULT_PRODUCTS_MAX teklif, toplam eslesme
 *      gosterilenden az olmaz (sinir gercekten asilir); bir teklif pasife cekilince o teklif
 *      gorunmez ve marketin toplami bir azalir (kontrol: asil katalog).
 */

import { SEARCH_QUERY_MAX_LENGTH, SEARCH_RESULT_PRODUCTS_MAX } from '@getir/contracts';
import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCatalogService } from '../../src/bootstrap.js';
import { offerIdFor } from '../../src/domain/catalog.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { demoLocation } from '../support/demo-addresses.js';
import { useCatalogWorld } from '../support/qa-catalog-world.js';

const world = useCatalogWorld('qa_catalog_arama');
/** "Ev"i kapsayan market (~400 m, 2,5 km yaricap, acik) ve oradaki aktif bir teklif. */
const PASSIVE_MARKET = 'mkt_migros-jet-moda';
const PASSIVE_PRODUCT = 'prd_sut-1l';
const PASSIVE_QUERY = 'Süt 1 L';
const HOME = demoLocation('Ev');
let memory: TestGrpcServer | undefined;
/** Salt okur testlerin ortak katalogu (tek seed; dosya sonunda kapanir). */
let shared: Promise<TestGrpcServer | undefined> | undefined;
const catalog = () =>
  (shared ??= world.open(CATALOG_SNAPSHOT, { shared: true }).then(([server]) => server));

beforeAll(async () => {
  memory = await startTestGrpcServer({
    serviceName: 'qa-catalog-bellek',
    services: [buildCatalogService({ readers: createInMemoryReaders(CATALOG_SNAPSHOT) })],
  });
});

afterAll(async () => {
  await memory?.stop();
});

const search = (server: TestGrpcServer | undefined, query: string) => {
  if (server === undefined) throw new Error('catalog sunucusu yok');
  return server.call(catalogV1.CatalogServiceService.searchNearby, { location: HOME, query });
};

/** Cevabin karsilastirilan hali: market sirasi, ad eslesmesi, teklifler ve toplam. */
async function results(server: TestGrpcServer | undefined, query: string) {
  const { response, error } = await search(server, query);
  if (response === undefined) throw new Error(`arama "${query}" dustu: ${error?.message ?? ''}`);
  return response.results.map((result) => ({
    marketId: result.market?.market?.id ?? '',
    nameMatched: result.marketNameMatched,
    offers: result.offers.map((offer) => offer.id),
    total: result.totalOfferMatches,
  }));
}

const offerIds = (found: Awaited<ReturnType<typeof results>>) =>
  found.flatMap((result) => result.offers);

describe('QA CQ2 genel arama (gercek Mongo, bellekle fark)', () => {
  it('A1 Turkce katlama, kelime ici ve sirasiz kelimeler; Mongo bellekle birebir', async () => {
    const mongo = await catalog();
    const groups: readonly (readonly string[])[] = [
      ['süt', 'SÜT', 'sut', '  Süt  '],
      ['TEREYAĞI', 'tereyagi', 'Tereyağı'],
      ['ÇİKOLATA', 'cikolata', 'Çikolata'],
      ['kıyma dana', 'dana kıyma', 'DANA KIYMA'],
    ];
    for (const group of groups) {
      const answers = [];
      for (const query of group) {
        const found = await results(mongo, query);
        expect(found, `bellek farki: ${query}`).toEqual(await results(memory, query));
        answers.push(found);
      }
      expect(offerIds(answers[0] ?? []).length, `${group[0] ?? ''} bos`).toBeGreaterThan(0);
      for (const [index, found] of answers.entries())
        expect(found, group[index]).toEqual(answers[0]);
    }
    // Kelime ICINDE (bas degil): "kolata" Çikolata'yi bulur.
    const chocolate = await results(mongo, 'çikolata');
    const infix = await results(mongo, 'kolata');
    expect(offerIds(chocolate).length).toBeGreaterThan(0);
    expect(infix).toEqual(await results(memory, 'kolata'));
    expect(offerIds(chocolate).every((id) => offerIds(infix).includes(id))).toBe(true);
  });

  it('A2 regex ozel karakterleri literal: hata yok, bellekle ayni; ".*" hicbir seyle eslesmez', async () => {
    const mongo = await catalog();
    // Sorgu en az iki karakter (A3): tek karakterlik ozel isaretler ikilenir.
    for (const query of ['.*', '((', '[a-z]', '\\\\', '$$', '^s', 'a|b', 's+', '{1}', ')(']) {
      expect(await results(mongo, query), query).toEqual(await results(memory, query));
    }
    // Ne teklif ne de market adi eslesir (market adi da regex degil, duz metin).
    expect(await results(mongo, '.*')).toEqual([]);
  });

  it('A3 uzunluk siniri (kirpildiktan sonra 2-64): iki yani; kisa ve uzun sorgu INVALID_ARGUMENT', async () => {
    const mongo = await catalog();
    const rejected = async (query: string) => {
      const { error } = await search(mongo, query);
      return [error?.code, appErrorOf(error)?.code];
    };
    const invalid = [GRPC_STATUS.INVALID_ARGUMENT, ERROR_CODES.VALIDATION_FAILED];
    expect(await rejected('s')).toEqual(invalid);
    expect(await rejected('   s   ')).toEqual(invalid);
    expect(await rejected('s'.repeat(SEARCH_QUERY_MAX_LENGTH + 1))).toEqual(invalid);
    expect((await search(mongo, 'sü')).error).toBeUndefined();
    expect((await search(mongo, 's'.repeat(SEARCH_QUERY_MAX_LENGTH))).error).toBeUndefined();
    // Uzunluk kirpildiktan SONRA: bosluklarla 66 karakter, kirpilinca 64 kabul.
    const padded = ` ${'s'.repeat(SEARCH_QUERY_MAX_LENGTH)} `;
    expect((await search(mongo, padded)).error).toBeUndefined();
  });

  it('A4 market basina teklif siniri asilir ama toplam dogru; pasife cekilen teklif gorunmez, toplam bir azalir', async () => {
    const mongo = await catalog();
    const broad = await results(mongo, 'ka');
    expect(broad).toEqual(await results(memory, 'ka'));
    expect(
      broad.every(
        ({ offers, total }) =>
          offers.length <= SEARCH_RESULT_PRODUCTS_MAX && total >= offers.length,
      ),
    ).toBe(true);
    // Sinir gercekten devrede: en az bir markette eslesme gosterilenden fazla.
    expect(broad.some(({ total }) => total > SEARCH_RESULT_PRODUCTS_MAX)).toBe(true);

    // Pasif teklif: kapsayan bir marketin aktif teklifi bir kopyada pasife cekilir (kontrol: asil
    // katalog). Yalniz o teklif kaybolur; marketin toplami bir azalir.
    const target = CATALOG_SNAPSHOT.offers.find(
      (offer) => offer.marketId === PASSIVE_MARKET && offer.productId === PASSIVE_PRODUCT,
    );
    if (target === undefined || !target.isActive)
      throw new Error('fixture teklifi yok ya da pasif');
    const passiveId = offerIdFor(PASSIVE_MARKET, PASSIVE_PRODUCT);
    const flipped = {
      ...CATALOG_SNAPSHOT,
      offers: CATALOG_SNAPSHOT.offers.map((offer) =>
        offer === target ? { ...offer, isActive: false } : offer,
      ),
    };
    const [withPassive] = await world.open(flipped);
    const marketOf = (found: Awaited<ReturnType<typeof results>>) =>
      found.find((result) => result.marketId === PASSIVE_MARKET);
    const control = marketOf(await results(mongo, PASSIVE_QUERY));
    const hidden = marketOf(await results(withPassive, PASSIVE_QUERY));
    expect(control?.offers).toContain(passiveId);
    expect(hidden?.offers ?? []).not.toContain(passiveId);
    expect(hidden?.total).toBe((control?.total ?? 0) - 1);
  });
});

/**
 * QA kara kutu (T15.2, order geriye donuk PR 2; OQ5): ListMyOrders ve GetOrder, iki order kopyasi
 * tek Mongo'da (qa-order-cluster.ts; gercek indeksler ve imlec sorgusu).
 *
 *   H1 sayfalama surerken yeni siparisler (imlecle AYNI anda, imlecin IKI yanina da dusen
 *      esitlikler dahil): tekrar ve atlama yok; ilk sayfadan sonrasi, imlecin gerisinde kalan butun
 *      siparisler, sirasiyla. Sayfalar iki kopyadan donusumlu (jeton kopyadan bagimsiz). Imlecin
 *      iki yanindaki esitlik BELIRLENIMCI: kimligi imlec +-1 olan, imlecle ayni anli iki kayit
 *      (neden: imlec uc rastgele kimligin en buyugu, Beta(3,1); 40 rastgele esitligin hicbiri ustune
 *      dusmeme olasiligi 3/43 ~ %7, CI titremesi #176). Bu iki kayit gRPC'den degil, uretimin
 *      deposuyla dogrudan yazilir (kimlik kaynagi enjekte edilemiyor); gorunurlukleri ve yerleri
 *      bastan okunan tam listede denetlenir.
 *   H2 jeton: bozuk ya da bicimsiz -> INVALID_ARGUMENT; baska kullanicinin jetonu yalniz KONUMDUR
 *      (MEVCUT: jeton kullaniciya bagli degil), cevapta yalniz kendi siparisleri; asiri buyuk zaman
 *      damgasi INTERNAL'a dusmez.
 *   H3 sayfa boyutu: 0 ve negatif varsayilan (20), ust sinirin ustu 100'e kirpilir; kirpilan
 *      sayfanin jetonu kalani verir.
 *   H4 sahiplik: baskasinin siparisi GetOrder, CancelOrder ve ConfirmPayment'ta olmayan siparisle
 *      AYNI hata (varlik sizmaz); siparis ve odeme degismez; listesine hic girmez.
 *
 * Liste yalnizca gecmiste gorunen siparisleri verir (#101): H1-H3'un siparisleri incelemeye duser
 * (REVIEW, gorunur). Inceleme kilidi birakir, stok doner: H3'un 101 siparisi stoga sigar. Gizli
 * siparislerin (taslak, odenmemis) listede olmamasi order'in kendi testlerinde
 * (order-history-listing-contract.ts, grpc/list-my-orders.spec.ts).
 */

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@getir/contracts';
import { ERROR_CODES, GRPC_STATUS, ID_PREFIX, isId, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { appErrorOf, appErrorPayloadOf } from '@getir/service-kit/testing';
import type { ServiceError } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';

import type { Order } from '../../src/domain/order.js';
import { openChallenge, useOrderClusters } from '../support/qa-order-cluster.js';
import type { OrderCluster } from '../support/qa-order-cluster.js';
import { useInventoryWorld } from '../support/qa-payment-world.js';

const world = useInventoryWorld('qa_order_gecmis');
const openCluster = useOrderClusters(world);

const PAGE = 4;
/** Imlecle ayni anda tam akistan gelen rastgele kimlikli siparisler (kopyalar donusumlu); yan sarti yok. */
const RANDOM_TIES = 2;
const ORDER_ID_BODY_LENGTH = 32;
/** Tam listeyi tek sayfada okumak icin (H1'de 15 siparis). */
const FULL_PAGE = PAGE_SIZE_MAX;
/** Jetonla gezilen en cok sayfa (H1-H3'un siparis sayilari bunun cok altinda kalir). */
const MAX_PAGES = 50;
const SECOND_MS = 1_000;

/**
 * Gecmiste gorunen siparis (#101): taslak ve siparis `copy` kopyasinda, inceleme bandi (HIGH) ->
 * REVIEW. Kilit birakilir (stok doner); kullanicinin sonraki taslagi bunu iptal etmez.
 */
async function reviewed(cluster: OrderCluster, copy: number, userId: string): Promise<string> {
  cluster.risk.bands.set(userId, RISK_BANDS.HIGH);
  const orderId = await cluster.copy(copy).calls.draft(userId);
  const placed = await cluster.copy(copy).calls.createOrder(orderId, userId);
  expect(appErrorOf(placed.error)?.code).toBe(ERROR_CODES.RISK_REVIEW);
  return orderId;
}

/** Kullanicinin sirayla verdigi, gecmiste gorunen siparisler (kopyalar donusumlu); kimlikler. */
async function ordersAt(
  cluster: OrderCluster,
  userId: string,
  plan: readonly { readonly at: number; readonly count: number }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const { at, count } of plan) {
    world.clock.set(at);
    for (let index = 0; index < count; index += 1) {
      ids.push(await reviewed(cluster, ids.length % 2, userId));
    }
  }
  return ids;
}

/** Gecmis sirasi (yeniden eskiye; esitlikte kimlik buyukten kucuge), testin kendi kurali. */
function newestFirst(orders: readonly Order[]): string[] {
  return [...orders]
    .sort((left, right) => {
      const byTime = right.createdAt.getTime() - left.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
    })
    .map((order) => order.id);
}

/**
 * Imlecin kaydinin kopyasi, kimligi imlecin hemen ustu (+1) ya da alti (-1): ayni kullanici, ayni
 * an, ayni durum (REVIEW, gorunur). Uretimin deposuyla yazilir (gecmis alani eslemede kurulur);
 * olay yok. Siralamada (ayni anda buyuk kimlik once) ust kimlik imlecin ONUNE, alt kimlik hemen
 * ARKASINA duser; aralarinda baska kimlik olamaz. Kopya imlecin rezervasyon alanlarini da tasir
 * (inventory bu kimligi bilmez): H1 yalniz listeyi okur; supurucu ve kurye iscisi REVIEW'e bakmaz.
 * Govde UUIDv4 oldugu icin +-1 tasmaz; sonuc UUIDv4 olmayabilir, bicim yine [0-9a-f]{32}.
 */
async function tieBeside(cluster: OrderCluster, cursor: Order, step: bigint): Promise<string> {
  const prefix = `${ID_PREFIX.ORDER}_`;
  const value = BigInt(`0x${cursor.id.slice(prefix.length)}`) + step;
  const id = `${prefix}${value.toString(16).padStart(ORDER_ID_BODY_LENGTH, '0')}`;
  if (!isId(ID_PREFIX.ORDER, id)) throw new Error(`imlecin yaninda kimlik yok: ${cursor.id}`);
  await cluster.orders.insert({ ...cursor, id }, []);
  return id;
}

async function recordsOf(cluster: OrderCluster, ids: readonly string[]): Promise<Order[]> {
  const records: Order[] = [];
  for (const id of ids) {
    const order = await cluster.orders.findById(id);
    if (order === null) throw new Error(`kayit yok: ${id}`);
    records.push(order);
  }
  return records;
}

/** Bir sayfa: kimlikler ve sonraki jeton; hata varsa firlatir. */
async function page(
  cluster: OrderCluster,
  copy: number,
  userId: string,
  pageSize: number,
  token = '',
): Promise<{ readonly ids: string[]; readonly next: string }> {
  const { response, error } = await cluster.copy(copy).calls.list(userId, pageSize, token);
  if (response === undefined) throw new Error(`liste okunamadi: ${error?.message ?? ''}`);
  return {
    ids: response.orders.map((order) => order.id),
    next: response.page?.nextPageToken ?? '',
  };
}

/**
 * Jetonun sonuna kadar butun sayfalar (kopyalar donusumlu). Sayfa sayisi sinirli: imlec kendini
 * tekrar ederse (dongu) test zaman asimina degil, acik bir hataya duser.
 */
async function rest(cluster: OrderCluster, userId: string, token: string): Promise<string[]> {
  const ids: string[] = [];
  let next = token;
  for (let copy = 1; next !== ''; copy += 1) {
    if (copy > MAX_PAGES)
      throw new Error(`sayfalama ${String(MAX_PAGES)} sayfada bitmedi (imlec dongusu)`);
    const current = await page(cluster, copy % 2, userId, PAGE, next);
    ids.push(...current.ids);
    next = current.next;
  }
  return ids;
}

const token = (raw: string) => Buffer.from(raw, 'utf8').toString('base64url');

/** Hatanin istemciye gorunen her seyi, siparis kimligi maskeli. */
function visible(error: ServiceError | undefined, orderId: string): string {
  const { requestId: _requestId, ...payload } = appErrorPayloadOf(error) ?? {};
  return JSON.stringify({
    grpc: error?.code,
    text: error?.details,
    payload,
  }).replaceAll(orderId, '<id>');
}

describe('QA OQ5 ListMyOrders ve GetOrder (iki kopya, gercek Mongo)', () => {
  it('H1 sayfalama surerken yeni siparis (imlecle ayni anda dahil): tekrar ve atlama yok', async () => {
    const cluster = await openCluster();
    const userId = cluster.nextUser();
    const t0 = world.clock.now();
    const originals = await ordersAt(cluster, userId, [
      { at: t0, count: 3 },
      { at: t0 + SECOND_MS, count: 3 },
      { at: t0 + 2 * SECOND_MS, count: 3 },
    ]);
    const first = await page(cluster, 0, userId, PAGE);
    expect(first.ids).toEqual(newestFirst(await recordsOf(cluster, originals)).slice(0, PAGE));

    // Sayfalar arasinda imlecle AYNI anda yeni siparisler: imlecin iki yaninda birer belirlenimci
    // kimlik ve tam akistan iki kopyadan rastgele kimlikliler.
    const cursor = await cluster.orders.findById(first.ids.at(-1) ?? '');
    if (cursor === null) throw new Error('imlec kaydi yok');
    const above = await tieBeside(cluster, cursor, 1n);
    const below = await tieBeside(cluster, cursor, -1n);
    world.clock.set(cursor.createdAt.getTime());
    const ties: string[] = [above, below];
    for (let index = 0; index < RANDOM_TIES; index += 1) {
      ties.push(await reviewed(cluster, index % 2, userId));
    }
    // Ayrica en yeni ve en eski grupta birer siparis.
    const inserted = [
      ...ties,
      ...(await ordersAt(cluster, userId, [
        { at: t0 + 3 * SECOND_MS, count: 1 },
        { at: t0, count: 1 },
      ])),
    ];
    const remaining = await rest(cluster, userId, first.next);

    const all = newestFirst(await recordsOf(cluster, [...originals, ...inserted]));
    // Iki kayit gercekten gorunur ve yerinde: bastan okunan tam liste ust, imlec, alt sirasinda.
    const fresh = await page(cluster, 1, userId, FULL_PAGE);
    expect(fresh.ids).toEqual(all);
    const cursorAt = all.indexOf(cursor.id);
    expect(all.slice(cursorAt - 1, cursorAt + 2), 'ust, imlec, alt').toEqual([
      above,
      cursor.id,
      below,
    ]);
    expect(remaining).toEqual(all.slice(cursorAt + 1));
    expect(remaining, 'ust kimlik imlecin onunde, bu taramada gorulmez').not.toContain(above);
    expect(remaining[0], 'alt kimlik imlecin hemen arkasinda').toBe(below);
    const seen = [...first.ids, ...remaining];
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of originals) expect(seen, id).toContain(id);
  });

  it('H2 jeton: bozuk ve bicimsiz INVALID_ARGUMENT; baska kullanicinin jetonu yalniz konum; buyuk zaman INTERNAL degil', async () => {
    const cluster = await openCluster();
    const owner = cluster.nextUser();
    const stranger = cluster.nextUser();
    const t0 = world.clock.now();
    const own = await ordersAt(cluster, owner, [{ at: t0, count: 3 }]);
    const theirs = await ordersAt(cluster, stranger, [{ at: t0 + SECOND_MS, count: 3 }]);

    for (const bad of [
      '%%%',
      token('yalnizmetin'),
      token('abc.ord_1'),
      token('-5.ord_1'),
      token('12.'),
    ]) {
      const { error } = await cluster.copy(0).calls.list(owner, PAGE, bad);
      expect(error?.code, bad).toBe(3);
      expect(appErrorOf(error)?.code, bad).toBe(ERROR_CODES.VALIDATION_FAILED);
    }

    // Yabancinin jetonu: onun siparisinin konumu (sahibinin siparislerinin hepsi daha eski):
    // cevap sahibinin BUTUN siparisleri, sirasiyla; yabancinin hicbiri.
    const foreign = (await page(cluster, 1, stranger, 1)).next;
    const listed = await rest(cluster, owner, foreign);
    expect(listed).toEqual(newestFirst(await recordsOf(cluster, own)));
    expect(listed.some((id) => theirs.includes(id))).toBe(false);

    // Date'in tasiyamadigi zaman damgasi: dogrulama hatasi ya da bos sayfa; INTERNAL degil.
    const huge = await cluster.copy(0).calls.list(owner, PAGE, token(`${'9'.repeat(20)}.ord_x`));
    const hugeOutcome =
      huge.error === undefined
        ? `sayfa ${String(huge.response?.orders.length)}`
        : `grpc ${String(huge.error.code)}`;
    expect(['sayfa 0', `grpc ${String(GRPC_STATUS.INVALID_ARGUMENT)}`]).toContain(hugeOutcome);
  });

  it('H3 sayfa boyutu: 0 ve negatif varsayilan, ust sinirin ustu kirpilir; jeton kalani verir', async () => {
    const cluster = await openCluster();
    const userId = cluster.nextUser();
    const ids = await ordersAt(cluster, userId, [
      { at: world.clock.now(), count: PAGE_SIZE_MAX + 1 },
    ]);

    expect((await page(cluster, 0, userId, 0)).ids).toHaveLength(PAGE_SIZE_DEFAULT);
    expect((await page(cluster, 1, userId, -5)).ids).toHaveLength(PAGE_SIZE_DEFAULT);
    const clamped = await page(cluster, 0, userId, PAGE_SIZE_MAX * 10);
    expect(clamped.ids).toHaveLength(PAGE_SIZE_MAX);
    const last = await page(cluster, 1, userId, PAGE_SIZE_MAX, clamped.next);
    expect(last).toEqual({ ids: [expect.any(String)], next: '' });
    expect(new Set([...clamped.ids, ...last.ids])).toEqual(new Set(ids));
  });

  it('H4 sahiplik: baskasinin siparisi olmayanla AYNI hata; siparis ve odeme degismez, listeye girmez', async () => {
    const cluster = await openCluster();
    const { orderId, userId, challengeId } = await openChallenge(cluster);
    const stranger = cluster.nextUser();
    const missing = `ord_${'0'.repeat(32)}`;
    const before = await cluster.orders.findById(orderId);

    const pairs = [
      [cluster.copy(0).calls.get(orderId, stranger), cluster.copy(0).calls.get(missing, stranger)],
      [
        cluster.copy(1).calls.cancel(orderId, stranger),
        cluster.copy(1).calls.cancel(missing, stranger),
      ],
      [
        cluster.copy(0).calls.confirm(orderId, stranger, challengeId),
        cluster.copy(0).calls.confirm(missing, stranger, challengeId),
      ],
    ] as const;
    for (const [foreign, absent] of pairs) {
      const [got, none] = await Promise.all([foreign, absent]);
      expect(appErrorOf(got.error)?.code).toBe(ERROR_CODES.NOT_FOUND);
      // Varlik sizmaz: gRPC kodu, metni ve uygulama yuku (kod, mesaj, ayrinti) olmayan siparisle
      // AYNI (kimlik maskeli; istek kimligi her cagride farkli, karsilastirilmaz).
      expect(visible(got.error, orderId)).toEqual(visible(none.error, missing));
    }

    const after = await cluster.orders.findById(orderId);
    expect(after?.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(after?.version).toBe(before?.version);
    expect(cluster.faults.calls('confirm3Ds', orderId)).toBe(0);
    expect((await page(cluster, 1, stranger, PAGE)).ids).not.toContain(orderId);
    const own = await cluster.copy(1).calls.get(orderId, userId);
    expect(own.response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
  });
});

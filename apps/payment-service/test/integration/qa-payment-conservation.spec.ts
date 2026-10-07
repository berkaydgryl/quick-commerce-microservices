/**
 * QA PQ1 (T15.2, payment geriye donuk): PARA KORUNUMU ozellik testi. Iki payment kopyasi tek
 * Mongo'da (qa-payment-cluster.ts); sabit tohumla karisik islem dizisi (qa-payment-model.ts), her
 * turda 1-8 islem ES ZAMANLI ve rastgele kopyaya. Her turdan sonra degismezler
 * (qa-payment-invariants.ts) Mongo belgesi, saglayici sayaci ve modelle denetlenir.
 *
 * Islemler: Charge (onay, ret, 3DS, kapida odeme, kayitli kart, silinmis kart, risk 3DS zorunlu),
 * ayni anahtarla tekrar, ayni anahtar baska tutar, ayni siparise baska anahtar, dogru ve yanlis
 * 3DS kodu, Refund RPC, cancel_requested ve refund_requested komutu (onaylanmayan komut sonraki
 * turda yeniden teslim edilir, event-bus gibi en cok maxDeliveries), kart ekleme ve silme, saatin
 * ilerlemesi (3DS penceresi). Once belirlenimci GIRIS her yolu ve her son durumu bir kez dener.
 *
 * I6 (iptalde para kalmaz) yalnizca iptal komutu ODEME KAYDINI GOREREK islendiyse uygulanir
 * (isleyicinin gunlukteki sonucu). "Odeme yok" diye onaylanan iptal, ayni anda suren Charge sonra
 * basarili olursa para iptal edilmis sipariste kalir: bilinen #136 penceresi (esik alti). Model
 * bunu sayar, ihlal saymaz; QA_PAYMENT_SUMMARY=1 ozet satirinda gorunur.
 *
 * Basarisiz kosu TOHUMU yazar; QA_PAYMENT_SEED (ondalik ya da 0x...) ayni islem planini verir.
 */

import { describe, expect, it } from 'vitest';

import { mongoEnv, startCluster, useMongo } from '../support/qa-payment-cluster.js';
import { violationsOf } from '../support/qa-payment-invariants.js';
import {
  deliver,
  MAX_DELIVERIES,
  operation,
  prelude,
  random,
  Run,
  SAVED_TOKENS,
  seedOf,
} from '../support/qa-payment-model.js';
import { logText, Payments, STATUS } from '../support/qa-payment-requests.js';

const mongo = useMongo();
const SEED = seedOf(process.env.QA_PAYMENT_SEED);
const SEED_NOTE = `tohum 0x${SEED.toString(16)} (QA_PAYMENT_SEED)`;
/** Tek kosu <= 3 dk hedefi (PM sarti 2): yerelde ~30 sn. */
const OPERATIONS = 1_200;
const MAX_BATCH = 8;
const TEST_TIMEOUT_MS = 180_000;

/** Denetimci: her turda yalniz YENI gunluk satirlarini tarar. */
class Checker {
  private scanned = 0;

  constructor(private readonly run: Run) {}

  async check(at: string): Promise<void> {
    const { cluster } = this.run;
    const violations = [
      ...this.run.unexpected.splice(0),
      ...violationsOf(await cluster.documents(), {
        authorized: cluster.provider.authorized,
        cancelled: this.run.cancelled,
      }),
    ];
    const fresh = logText(cluster.lines.slice(this.scanned));
    this.scanned = cluster.lines.length;
    for (const token of SAVED_TOKENS) {
      if (fresh.includes(token)) violations.push(`I7 gunlukte jeton ${token}`);
    }
    expect(violations, `${at}; ${SEED_NOTE}`).toEqual([]);
  }
}

/** gRPC'nin okudugu durum belgeyle ayni (son durumda her kayit, kopyalara dagitilarak). */
async function expectReadsMatch(run: Run): Promise<void> {
  const documents = await run.cluster.documents();
  const reads = await Promise.all(
    documents.map((document, index) =>
      run.cluster.copy(index).call(Payments.getPayment, { orderId: document.orderId }),
    ),
  );
  const mismatched = documents.filter(
    (document, index) =>
      reads[index]?.response?.payment?.status !==
      STATUS[`PAYMENT_STATUS_${document.status}` as keyof typeof STATUS],
  );
  expect(
    mismatched.map((document) => document.orderId),
    SEED_NOTE,
  ).toEqual([]);
}

/** Ozet (yalniz QA_PAYMENT_SUMMARY=1): #136 penceresine dusen iptaller ihlal sayilmaz. */
async function summarize(run: Run): Promise<void> {
  if (process.env.QA_PAYMENT_SUMMARY !== '1') return;
  const documents = await run.cluster.documents();
  const window136 = documents.filter(
    (document) =>
      run.cancelledWithoutPayment.has(document.orderId) &&
      !run.cancelled.has(document.orderId) &&
      document.status === 'SUCCEEDED',
  ).length;
  process.stdout.write(
    `QA PQ1 ozet ${SEED_NOTE}: ${documents.length} odeme, ` +
      `authorize ${run.cluster.provider.authorized}, iptal (kayitli) ${run.cancelled.size}, ` +
      `iptal (kayitsiz) ${run.cancelledWithoutPayment.size}, #136 penceresi ${window136}\n`,
  );
}

describe('QA PQ1 para korunumu (iki kopya, tek Mongo, sabit tohum)', () => {
  it(
    `belirlenimci giris + ${OPERATIONS} karisik islem, turlarda es zamanli: her turdan sonra para degismezleri`,
    async () => {
      const env = mongoEnv(mongo().uri);
      const cluster = await startCluster({ copies: [env, env], inspect: env });
      try {
        const run = new Run(cluster, random(SEED));
        const checker = new Checker(run);
        await prelude(run);
        await checker.check('giris');
        let done = 0;
        let round = 0;
        while (done < OPERATIONS) {
          round += 1;
          const size = Math.min(1 + Math.floor(run.next() * MAX_BATCH), OPERATIONS - done);
          const redelivered = run.redeliver.splice(0).map((pending) => deliver(run, pending));
          const started = Array.from({ length: size }, () => operation(run));
          await Promise.all([...redelivered, ...started]);
          done += size;
          await checker.check(`tur ${round}, islem ${done}`);
        }
        // Bekleyen komutlar bitene kadar (en cok MAX_DELIVERIES tur).
        for (let drain = 0; run.redeliver.length > 0 && drain < MAX_DELIVERIES; drain += 1) {
          await Promise.all(run.redeliver.splice(0).map((pending) => deliver(run, pending)));
        }
        await checker.check('son');
        await expectReadsMatch(run);
        await summarize(run);

        // Her yol ve her son durum gercekten denendi; belirlenimci giris garanti eder.
        const statuses = new Set((await cluster.documents()).map((document) => document.status));
        expect([...statuses].sort(), SEED_NOTE).toEqual([
          'CANCELLED',
          'FAILED',
          'PENDING',
          'REFUNDED',
          'REQUIRES_3DS',
          'SUCCEEDED',
        ]);
        for (const path of [
          'charge:ok',
          'charge:NOT_FOUND',
          'replay:ok',
          'otherAmount:CONFLICT',
          'otherKey:CONFLICT',
          'confirm-dogru:ok',
          'confirm-yanlis:THREEDS_FAILED',
          'refund:ok',
          'refund:CONFLICT',
          'addCard:ok',
          'deleteCard:ok',
          'payment.cancel_requested:handled',
        ]) {
          expect(run.seen, `${path}; ${SEED_NOTE}`).toContain(path);
        }
      } finally {
        await cluster.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

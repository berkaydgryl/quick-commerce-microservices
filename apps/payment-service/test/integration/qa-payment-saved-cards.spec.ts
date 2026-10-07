/**
 * QA PQ7 (T15.2, payment geriye donuk PR 2): kayitli kart Mongo'da uctan uca, iki payment kopyasi
 * (qa-payment-cluster.ts). #172'den beri mock, kart ureticisinin Luhn'u gecerli her numarasini
 * onaylar ve RASTGELE bir jeton verir (tok_<32 onaltilik>); jeton testte bilinmez, kasanin
 * belgesinden okunur ve her yerde aranir.
 *
 *   a) uretilmis kart: kasaya eklenir, baska kopyadan kayitli kartla cekilir; odeme belgesinde
 *      yalniz kart kimligi; jeton, numara ve CVV ne odeme belgesinde ne gunlukte (Error dahil).
 *   b) risk 3DS isterse uretilmis kart REQUIRES_3DS, mock kodla SUCCEEDED.
 *   c) sahiplik: baskasinin, silinmis ve hic olmamis kart AYNI NOT_FOUND {resource:'card'};
 *      kayit yazilmaz, kimlik yankilanmaz.
 *   d) ayni numara iki kullanicida: ayri jeton; birinin silmesi digerini etkilemez.
 *   e) MEVCUT (#118): eski card_token yolu iyi bicimli her uretilmis jetonla kasayi atlar.
 */

import { ERROR_CODES, ID_PREFIX, newId } from '@getir/core';
import { appErrorOf, appErrorPayloadOf } from '@getir/service-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { mongoEnv, startCluster, useMongo } from '../support/qa-payment-cluster.js';
import type { PaymentCluster } from '../support/qa-payment-cluster.js';
import {
  addCardRequest,
  chargeRequest,
  confirmRequest,
  generatedVisa,
  logText,
  newOrder,
  newUser,
  Payments,
  RIGHT_CODE,
  STATUS,
  Vault,
} from '../support/qa-payment-requests.js';

const mongo = useMongo();
const TEST_TIMEOUT_MS = 60_000;
const CVV = '731';
/** Uretilmis jetonun bicimi (mock-payment-provider.ts GENERATED_TOKEN). */
const GENERATED_TOKEN = /^tok_[0-9a-f]{32}$/;
const NOT_FOUND_CARD = { code: ERROR_CODES.NOT_FOUND, details: { resource: 'card' } };

let cluster: PaymentCluster | undefined;
afterEach(async () => {
  const running = cluster;
  cluster = undefined;
  await running?.stop();
});

async function open(): Promise<PaymentCluster> {
  const env = mongoEnv(mongo().uri);
  cluster = await startCluster({ copies: [env, env], inspect: env });
  return cluster;
}

/** Uretilmis karti kasaya ekler; kart kimligi ve kasanin sakladigi saglayici jetonu. */
async function addGenerated(target: PaymentCluster, userId: string, number: string) {
  const { response, error } = await target
    .copy(0)
    .call(Vault.addCard, { ...addCardRequest(userId), number, cvv: CVV });
  expect(error).toBeUndefined();
  const cardId = response?.card?.id ?? '';
  const token = (await target.card(cardId))?.providerToken ?? '';
  expect(token).toMatch(GENERATED_TOKEN);
  return { cardId, token };
}

describe('QA PQ7 kayitli kart Mongo da uctan uca (kart ureticisi, #172)', () => {
  it(
    'a) uretilmis kart eklenir, baska kopyadan cekilir; jeton, numara ve CVV belgede ve gunlukte yok',
    async () => {
      const target = await open();
      const order = newOrder();
      const number = generatedVisa(7_300_001);
      const { cardId, token } = await addGenerated(target, order.userId, number);

      const { response, error } = await target
        .copy(1)
        .call(Payments.charge, chargeRequest(order, { kind: 'saved', cardId }));

      expect(error).toBeUndefined();
      expect(response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
      expect(JSON.stringify(response)).not.toContain(token);
      expect(await target.documentOf(order.orderId)).toMatchObject({ cardId, status: 'SUCCEEDED' });
      const stored = JSON.stringify(await target.documents());
      const logged = logText(target.lines);
      // CVV uc hane: onaltilik kimliklerde tesadufen gecebilir; tam JSON degeri ve alan adi aranir.
      for (const secret of [token, number, number.slice(4, 12), `"${CVV}"`, '"cvv"']) {
        expect(stored).not.toContain(secret);
        expect(logged).not.toContain(secret);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'b) risk 3DS isterse uretilmis kart REQUIRES_3DS, mock kodla SUCCEEDED',
    async () => {
      const target = await open();
      const order = newOrder();
      const { cardId } = await addGenerated(target, order.userId, generatedVisa(7_300_002));

      const charged = await target
        .copy(0)
        .call(
          Payments.charge,
          chargeRequest(order, { kind: 'saved', cardId }, { requireThreeDs: true }),
        );
      expect(charged.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_REQUIRES_3DS);
      const confirmed = await target
        .copy(1)
        .call(
          Payments.confirm3Ds,
          confirmRequest(order, charged.response?.challengeId ?? '', RIGHT_CODE),
        );

      expect(confirmed.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'c) sahiplik: baskasinin, silinmis ve hic olmamis kart ayni NOT_FOUND; kayit yok, kimlik yankilanmaz',
    async () => {
      const target = await open();
      const owner = newUser();
      const { cardId } = await addGenerated(target, owner, generatedVisa(7_300_003));
      const deleted = await addGenerated(target, owner, generatedVisa(7_300_004));
      await target.copy(1).call(Vault.deleteCard, { userId: owner, cardId: deleted.cardId });

      const attempts = [
        { label: 'baskasinin', userId: newUser(), cardId },
        { label: 'silinmis', userId: owner, cardId: deleted.cardId },
        { label: 'hic olmamis', userId: owner, cardId: newId(ID_PREFIX.CARD) },
      ];
      for (const attempt of attempts) {
        const order = newOrder(attempt.userId);
        const { error } = await target
          .copy(0)
          .call(Payments.charge, chargeRequest(order, { kind: 'saved', cardId: attempt.cardId }));
        expect({ label: attempt.label, error: appErrorOf(error) }).toEqual({
          label: attempt.label,
          error: NOT_FOUND_CARD,
        });
        // Kimlik ne gRPC iletisinde ne x-app-error govdesinde (ileti dahil) yankilanir.
        expect(`${error?.message ?? ''} ${JSON.stringify(appErrorPayloadOf(error))}`).not.toContain(
          attempt.cardId,
        );
        expect(await target.document(order.orderId)).toBeNull();
      }
      // Sahibi ayni karti kullanabilir (kontrol: ret sahipligi denetliyor, karti degil).
      const own = newOrder(owner);
      const paid = await target
        .copy(1)
        .call(Payments.charge, chargeRequest(own, { kind: 'saved', cardId }));
      expect(paid.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'd) ayni uretilmis numara iki kullanicida: ayri jeton; birinin silmesi digerini etkilemez',
    async () => {
      const target = await open();
      const number = generatedVisa(7_300_005);
      const [first, second] = [newUser(), newUser()];
      const one = await addGenerated(target, first, number);
      const two = await addGenerated(target, second, number);
      expect(one.token).not.toBe(two.token);
      expect(one.cardId).not.toBe(two.cardId);

      await target.copy(1).call(Vault.deleteCard, { userId: first, cardId: one.cardId });

      const refused = await target
        .copy(0)
        .call(
          Payments.charge,
          chargeRequest(newOrder(first), { kind: 'saved', cardId: one.cardId }),
        );
      expect(appErrorOf(refused.error)).toEqual(NOT_FOUND_CARD);
      const kept = await target
        .copy(0)
        .call(
          Payments.charge,
          chargeRequest(newOrder(second), { kind: 'saved', cardId: two.cardId }),
        );
      expect(kept.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
      expect((await target.card(two.cardId))?.providerToken).toBe(two.token);
    },
    TEST_TIMEOUT_MS,
  );

  // #118: card_token alani kalkinca TERSINE donecek (eski yol yok: VALIDATION_FAILED).
  it(
    'e) MEVCUT davranis: eski card_token yolu, kimsenin almadigi iyi bicimli jetonla kasayi ve sahipligi atlar',
    async () => {
      const target = await open();
      const order = newOrder();
      const fabricated = `tok_${'ab'.repeat(16)}`;

      const { response, error } = await target
        .copy(0)
        .call(Payments.charge, chargeRequest(order, { kind: 'token', token: fabricated }));

      expect(error).toBeUndefined();
      expect(response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
      // Kasada boyle bir kart yok; odeme kayitli karta bagli degil.
      expect((await target.documentOf(order.orderId)).cardId).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );
});

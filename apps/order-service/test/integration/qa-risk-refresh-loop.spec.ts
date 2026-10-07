/**
 * QA kara kutu (T15.2, risk geriye donuk PR 1; RQ0): odemede 3DS beklerken sayfadan donup yeniden
 * siparis verme dongusu (kullanicinin sorusu). order + GERCEK risk (uretimin kurallari ve
 * agirliklari) + gercek payment ve inventory, ortak sahte saat, temiz gateway sinyalleri
 * (qa-risk-world.ts). Yalniz olcum ve belge: MEVCUT davranis tablo olarak kilitlenir.
 *
 * Bir tur web'in yaptigi: sayfa acilisi = rezervasyon (taslak; dwell burada baslar), dwell kadar
 * bekleme, kartla siparis; orta bantta 3DS ve k yanlis kod. Turun sonu iki turlu:
 *   vazgec  3DS penceresi kapatilir ya da sure dolar: web birakir (DELETE /v1/cart/reserve =
 *           CancelOrder) -> USER_CANCELLED (risk gecmisinde SAYILIR). Kullanicinin kaniti bu yol.
 *   f5      yalniz sayfa yenilenir: web birakmaz (unload yok); yeni rezervasyon kilit dusene kadar
 *           RESERVATION_ACTIVE alir, sonra supurucu eskiyi RESERVATION_EXPIRED ile kapatir (SAYILMAZ).
 * Satir: "puan BANT [tetiklenen kurallar] 3ds:<kalan haklar>|yok durum"; f5 satiri bekleme.
 *
 *   Y1 kullanicinin dizisi (hesap 1 sa, 1 teslim): hizli tur 35 MEDIUM (hesap yasi + dwell), 3DS,
 *      iki yanlis kod, vazgec; bekleyen tur 20 LOW (yalniz hesap yasi), 3DS YOK, PAID; para bir kez,
 *      vazgecilen siparisin odemesi kapanir (sonradan cekilemez).
 *   Y2 "iki yanlis + vazgec" alti tur: her sipariste 3 hak bastan; iptal sayisi teslimi gecince
 *      order-history (+15) 50, HIGH (55) gelmez: dongunun sayi siniri yok (yalniz hiz siniri, RQ0c).
 *   Y3 "uc yanlis (hak biter)" alti tur: PAYMENT_FAILED gecmise SAYILMAZ, puan hep 35.
 *   Y4 karsilastirma: teslim gecmisi yoksa beklemek MEDIUM'dan indirmez; eski hesap bot hizinda LOW.
 *   Y5 "yalniz F5": yeni tur ancak kilit dusunce; eski siparis sistem notuyla kapanir, gecmise
 *      sayilmaz (puan artmaz). Tur basina bekleme orta bant kilidi kadar.
 *   Y6 baska sinyal donguyu durdurur: oturum baska sehirde (geofence +15) -> iki vazgecten sonra 65
 *      HIGH, siparis REVIEW.
 */

import { ERROR_CODES, ORDER_STATUS } from '@getir/core';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { PAYMENT_STATUS } from '../../../payment-service/src/domain/payment.js';
import { moneyOf } from '../support/qa-money-checks.js';
import { nextUser, WRONG_CODE } from '../support/qa-order-calls.js';
import { useInventoryWorld } from '../support/qa-payment-world.js';
import { cleanSignals, useRiskShops } from '../support/qa-risk-world.js';
import type { RiskShop } from '../support/qa-risk-world.js';

const world = useInventoryWorld('qa_risk_yenileme');
const openShop = useRiskShops(world);

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
/** checkout-dwell esiginin (3000 ms) altinda ve ustunde. */
const FAST_MS = 1_000;
const SLOW_MS = 4_000;
const CYCLES = 6;
/** F5'te yeni rezervasyon denemeleri arasi (web'in "Sipariş Ver" tekrarina benzer). */
const RETRY_STEP_MS = 10_000;
/** F5 beklemesinin ust siniri: taslak kilidinin en uzun omru (15 dk). */
const F5_WAIT_LIMIT_MS = 15 * 60 * 1_000;
/** Teslimat konumundan (Istanbul) 50 km'den uzak oturum: Ankara. */
const FAR_AWAY = { lat: 39.93, lng: 32.85 };

interface Profile {
  readonly ageMs: number;
  readonly delivered: number;
  readonly sessionLocation?: { readonly lat: number; readonly lng: number };
}

interface Turn {
  readonly dwellMs: number;
  /** 3DS istenirse girilen yanlis kod sayisi. */
  readonly wrongCodes: number;
  readonly end: 'vazgec' | 'f5' | 'yok';
}

interface Played {
  readonly rows: string[];
  readonly orderIds: string[];
}

/** Turlar; her tur bir satir (F5 beklemesi ayrica bir satir). */
async function play(shop: RiskShop, profile: Profile, turns: readonly Turn[]): Promise<Played> {
  const userId = nextUser();
  await shop.delivered(userId, profile.delivered);
  const signals = cleanSignals(
    new Date(world.clock.now() - profile.ageMs),
    profile.sessionLocation,
  );
  const played: Played = { rows: [], orderIds: [] };
  for (const turn of turns) {
    const orderId = await openDraft(shop, userId, played);
    world.clock.advance(turn.dwellMs);
    const created = await shop.order(orderId, userId, signals);
    const evaluation = await shop.evaluation(userId, orderId);
    const fired = (evaluation?.hits ?? []).filter((hit) => hit.hit).map((hit) => hit.ruleId);
    const challengeId = created.response?.challengeId ?? '';
    const left: string[] = [];
    for (let code = 0; challengeId !== '' && code < turn.wrongCodes; code += 1) {
      const wrong = appErrorOf(
        (await shop.calls.confirm(orderId, userId, challengeId, WRONG_CODE)).error,
      );
      const details: unknown = wrong?.details;
      left.push(
        wrong?.code === ERROR_CODES.THREEDS_FAILED &&
          typeof details === 'object' &&
          details !== null &&
          'attemptsLeft' in details
          ? String(details.attemptsLeft)
          : `hata ${String(wrong?.code)}`,
      );
    }
    const status = (await shop.orders.findById(orderId))?.status;
    played.orderIds.push(orderId);
    played.rows.push(
      `${String(evaluation?.score)} ${String(evaluation?.band)} [${fired.sort().join(',')}] ` +
        `3ds:${challengeId === '' ? 'yok' : left.join(',') || 'var'} ${String(status)}`,
    );
    if (turn.end === 'vazgec' && status === ORDER_STATUS.AWAITING_PAYMENT) {
      expect((await shop.calls.cancel(orderId, userId)).error).toBeUndefined();
    }
  }
  return played;
}

/**
 * Sayfa acilisinin rezervasyonu. Onceki siparis odeme asamasinda ve kilidi duruyorsa (F5)
 * RESERVATION_ACTIVE: saat ilerler, supuruculer kosar, yeniden denenir; bekleme ve onceki
 * siparisin sonu bir satir olur.
 */
async function openDraft(shop: RiskShop, userId: string, played: Played): Promise<string> {
  let waitedMs = 0;
  for (;;) {
    const { response, error } = await shop.calls.tryDraft(userId);
    if (response !== undefined) {
      if (waitedMs > 0) {
        const previous = await shop.orders.findById(played.orderIds.at(-1) ?? '');
        const note = previous?.timeline.at(-1)?.note;
        played.rows.push(
          `f5: ${String(waitedMs / 1_000)} sn RESERVATION_ACTIVE; onceki ${String(previous?.status)} ${String(note)}`,
        );
      }
      return response.orderId;
    }
    expect(appErrorOf(error)?.code, 'taslak').toBe(ERROR_CODES.RESERVATION_ACTIVE);
    if (waitedMs >= F5_WAIT_LIMIT_MS) throw new Error('F5 beklemesi kilit omrunu asti');
    world.clock.advance(RETRY_STEP_MS);
    waitedMs += RETRY_STEP_MS;
    await shop.sweep();
  }
}

const repeat = (turn: Turn): Turn[] => Array.from({ length: CYCLES }, () => turn);

const NEW_ACCOUNT_ONE_DELIVERY: Profile = { ageMs: HOUR_MS, delivered: 1 };
const MEDIUM = '35 MEDIUM [account-age,checkout-dwell]';
const WITH_HISTORY = '50 MEDIUM [account-age,checkout-dwell,order-history]';

describe('QA RQ0 3DS beklerken donup yeniden siparis (gercek risk kurallari)', () => {
  it('Y1 kullanicinin dizisi: hizli tur MEDIUM ve 3DS, vazgec, bekleyen tur LOW, 3DS yok, PAID; para bir kez', async () => {
    const shop = await openShop();

    const { rows, orderIds } = await play(shop, NEW_ACCOUNT_ONE_DELIVERY, [
      { dwellMs: FAST_MS, wrongCodes: 2, end: 'vazgec' },
      { dwellMs: SLOW_MS, wrongCodes: 0, end: 'yok' },
    ]);

    expect(rows).toEqual([
      `${MEDIUM} 3ds:2,1 AWAITING_PAYMENT`,
      '20 LOW [account-age] 3ds:yok PAID',
    ]);
    const [abandoned = '', paid = ''] = orderIds;
    const first = await shop.orders.findById(abandoned);
    expect([first?.status, first?.timeline.at(-1)?.note]).toEqual([
      ORDER_STATUS.CANCELLED,
      'USER_CANCELLED',
    ]);
    // Vazgecilen siparisin 3DS odemesi iptal komutuyla kapanir: sonradan cekilemez.
    await shop.deliverPaymentCommands();
    expect((await shop.payments.findByOrderId(abandoned))?.status).toBe(PAYMENT_STATUS.CANCELLED);
    expect(await moneyOf(shop, abandoned)).toEqual({ charged: 0, refunded: 0 });
    expect(await moneyOf(shop, paid)).toEqual({ charged: 1, refunded: 0 });
  });

  it('Y2 iki yanlis + vazgec, alti tur: her sipariste 3 hak bastan; puan 50 ye cikar, HIGH yok', async () => {
    const { rows } = await play(
      await openShop(),
      NEW_ACCOUNT_ONE_DELIVERY,
      repeat({ dwellMs: FAST_MS, wrongCodes: 2, end: 'vazgec' }),
    );

    // 1 teslim: iptal 1 iken oran %50 (tetiklemez), 2'den itibaren tetikler.
    const first = `${MEDIUM} 3ds:2,1 AWAITING_PAYMENT`;
    const later = `${WITH_HISTORY} 3ds:2,1 AWAITING_PAYMENT`;
    expect(rows).toEqual([first, first, later, later, later, later]);
  });

  it('Y3 uc yanlis (hak biter), alti tur: PAYMENT_FAILED gecmise sayilmaz, puan hep 35', async () => {
    const { rows } = await play(
      await openShop(),
      NEW_ACCOUNT_ONE_DELIVERY,
      repeat({ dwellMs: FAST_MS, wrongCodes: 3, end: 'vazgec' }),
    );

    expect(rows).toEqual(
      Array.from({ length: CYCLES }, () => `${MEDIUM} 3ds:2,1,0 PAYMENT_FAILED`),
    );
  });

  it('Y4 karsilastirma: teslim gecmisi yoksa beklemek MEDIUM dan indirmez; eski hesap bot hizinda LOW', async () => {
    const fresh = await play(await openShop(), { ageMs: HOUR_MS, delivered: 0 }, [
      { dwellMs: FAST_MS, wrongCodes: 0, end: 'vazgec' },
      { dwellMs: SLOW_MS, wrongCodes: 0, end: 'vazgec' },
    ]);
    expect(fresh.rows).toEqual([
      '50 MEDIUM [account-age,checkout-dwell,order-history] 3ds:var AWAITING_PAYMENT',
      '35 MEDIUM [account-age,order-history] 3ds:var AWAITING_PAYMENT',
    ]);

    const settled = await play(await openShop(), { ageMs: 30 * DAY_MS, delivered: 1 }, [
      { dwellMs: FAST_MS, wrongCodes: 0, end: 'yok' },
    ]);
    expect(settled.rows).toEqual(['15 LOW [checkout-dwell] 3ds:yok PAID']);
  });

  it('Y5 yalniz F5: yeni tur kilit dusunce; eski siparis sistem notuyla kapanir, puan artmaz', async () => {
    const { rows } = await play(await openShop(), NEW_ACCOUNT_ONE_DELIVERY, [
      { dwellMs: FAST_MS, wrongCodes: 2, end: 'f5' },
      { dwellMs: FAST_MS, wrongCodes: 2, end: 'f5' },
      { dwellMs: FAST_MS, wrongCodes: 2, end: 'f5' },
    ]);

    const turn = `${MEDIUM} 3ds:2,1 AWAITING_PAYMENT`;
    const wait = 'f5: 120 sn RESERVATION_ACTIVE; onceki CANCELLED RESERVATION_EXPIRED';
    expect(rows).toEqual([turn, wait, turn, wait, turn]);
  });

  it('Y6 oturum baska sehirde (geofence): iki vazgecten sonra 65 HIGH, siparis incelemede; dongu durur', async () => {
    const { rows } = await play(
      await openShop(),
      { ...NEW_ACCOUNT_ONE_DELIVERY, sessionLocation: FAR_AWAY },
      repeat({ dwellMs: FAST_MS, wrongCodes: 2, end: 'vazgec' }).slice(0, 3),
    );

    const far = '50 MEDIUM [account-age,checkout-dwell,geofence] 3ds:2,1 AWAITING_PAYMENT';
    expect(rows).toEqual([
      far,
      far,
      '65 HIGH [account-age,checkout-dwell,geofence,order-history] 3ds:yok REVIEW',
    ]);
  });
});

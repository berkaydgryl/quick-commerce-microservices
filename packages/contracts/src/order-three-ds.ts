/**
 * Siparis ayrintisindaki 3DS durumu (#163 B1; GET /v1/orders/{id}, web F15b):
 * sayfa yenilense de bekleyen dogrulama kaldigi yerden surdurulur.
 *
 * Yalnizca durum AWAITING_PAYMENT iken ve yalnizca siparisin SAHIBINE doner
 * (Cache-Control: no-store). Kod (OTP) hicbir zaman, hicbir yerde yoktur.
 *
 * IKI BICIM + YOKLUK:
 *   - acik   : challengeId VAR, ttlSeconds >= 1, attemptsLeft >= 1; kod
 *              POST /v1/orders/{id}/3ds ile girilir.
 *   - kapali : challengeId YOK; ttlSeconds = 0 (suresi doldu) ya da
 *              attemptsLeft = 0 (hakki bitti; ikisi birden ise "hakki bitti").
 *              Yeni kod ucu YOK (karar S1 a). Suresi dolan siparis stok kilidi
 *              bitince kapanir (supurucu). Hakki biten dogrulamada siparis
 *              normalde ANINDA PAYMENT_FAILED olur (alan gelmez); "hakki bitti"
 *              yalnizca o gecis anina denk gelen okumada gorulur.
 *   - alan yok: BILINMIYOR (odeme servisine ulasilamadi) ya da dogrulama yok.
 *              Web siparisi BIRAKMAZ, tekrar yoklar.
 *
 * TEK SAAT: gateway ttlSeconds'i expires_at'tan KENDI saatiyle hesaplar ve
 * challengeId'yi yalnizca kendi hesabi "acik" diyorsa koyar. attemptsLeft = en
 * fazla hak - yanlis kod sayisi, dogrulama hangi sebeple kapanmis olursa olsun
 * (suresi dolan dogrulamada da).
 *
 * SAAT YARISI DAYANIKLILIGI: bicim jetona gore secilir. Jetonsuz durum HER ZAMAN
 * kapalidir (or. odeme "doldu" dedi, gateway'in saati 1 sn kaldi diyor: hak
 * varsa "suresi doldu"); kapali durumda gelen jeton atilir. Boylece iki
 * servisin saat farki siparisin okunmasini dusurmez.
 */

import { ID_PREFIX } from '@getir/core';
import { z } from 'zod';

/** 3DS dogrulama jetonu: `tds_` + 32 onaltilik (Confirm3Ds'e oldugu gibi gider). */
export const threeDsChallengeIdSchema = z
  .string()
  .regex(new RegExp(`^${ID_PREFIX.THREEDS_CHALLENGE}_[0-9a-f]{32}$`), {
    message: 'gecersiz 3DS jetonu',
  });

/** Acik dogrulama: kod girilebilir. */
export const openOrderThreeDsSchema = z.object({
  challengeId: threeDsChallengeIdSchema,
  /** Kodun sunucunun saatiyle kalan gecerliligi, saniye. */
  ttlSeconds: z.number().int().min(1),
  /** Kalan yanlis kod hakki. */
  attemptsLeft: z.number().int().min(1),
});

/**
 * Kapali dogrulama: jeton YOK (gelse de atilir). Normalde ttlSeconds ya da
 * attemptsLeft 0'dir; saat yarisinda ikisi de > 0 gelebilir, yine kapalidir.
 */
export const closedOrderThreeDsSchema = z.object({
  ttlSeconds: z.number().int().min(0),
  attemptsLeft: z.number().int().min(0),
});

export const orderThreeDsSchema = z.union([openOrderThreeDsSchema, closedOrderThreeDsSchema]);

export type OpenOrderThreeDs = z.infer<typeof openOrderThreeDsSchema>;
export type ClosedOrderThreeDs = z.infer<typeof closedOrderThreeDsSchema>;
export type OrderThreeDs = z.infer<typeof orderThreeDsSchema>;

/** Dogrulamanin durumu (web: ne gosterilecek). */
export const ORDER_THREE_DS_STATE = {
  OPEN: 'open',
  EXPIRED: 'expired',
  EXHAUSTED: 'exhausted',
} as const;

export type OrderThreeDsState = (typeof ORDER_THREE_DS_STATE)[keyof typeof ORDER_THREE_DS_STATE];

/** Acik mi: tipi daraltir (kod gondermek icin jeton kesin vardir). */
export function isOpenOrderThreeDs(threeDs: OrderThreeDs): threeDs is OpenOrderThreeDs {
  return 'challengeId' in threeDs;
}

/** Acik degilse: hak bittiyse `exhausted` (sure de dolmus olsa), aksi halde `expired`. */
export function orderThreeDsState(threeDs: OrderThreeDs): OrderThreeDsState {
  if (isOpenOrderThreeDs(threeDs)) {
    return ORDER_THREE_DS_STATE.OPEN;
  }
  return threeDs.attemptsLeft === 0 ? ORDER_THREE_DS_STATE.EXHAUSTED : ORDER_THREE_DS_STATE.EXPIRED;
}

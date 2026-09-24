/**
 * gRPC istek semalari (Zod): proto mesajini domain baglamina cevirir.
 *
 * "0 MI, YOK MU?" (T6.3 karari, risk.proto yorumu): proto3'te gonderilmeyen
 * sayi 0, metin "" gelir. Burada tek yerde cozulur:
 *   - checkoutDwellMs 0, accountsOnDevice 0 -> YOK (olculmedi). Aksi halde
 *     rezervasyon oncesi ilk degerlendirmede herkes "0 ms, bot" sayilirdi.
 *   - deliveredOrderCount / cancelledOrderCount 0 -> gercekten 0.
 *   - bos metin -> yok; gonderilmeyen mesaj (zaman, konum, tutar) -> yok.
 * Domain nesnesine "yok" alan HIC yazilmaz (exactOptionalPropertyTypes).
 */

import { z } from 'zod';

import type { RiskContext } from '../../domain/risk-context.js';

const requiredText = (field: string) => z.string().trim().min(1, `${field} zorunlu`);

/** "" -> undefined. */
const optionalText = z
  .string()
  .transform((value) => (value.trim() === '' ? undefined : value.trim()));

/** 0 -> undefined ("olculmedi"); negatif gecersiz. */
const zeroMeansMissing = z
  .number()
  .int()
  .min(0)
  .transform((value) => (value === 0 ? undefined : value));

const count = z.number().int().min(0);

const geoPoint = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .optional();

const money = z.object({ amountMinor: z.number().int().min(0) }).optional();

const contextSchema = z.object(
  {
    userId: requiredText('userId'),
    orderId: optionalText,
    marketId: optionalText,
    accountCreatedAt: z.date().optional(),
    deliveredOrderCount: count,
    cancelledOrderCount: count,
    basketTotal: money,
    userAverageBasket: money,
    checkoutDwellMs: zeroMeansMissing,
    deliveryLocation: geoPoint,
    sessionLocation: geoPoint,
    ipAddress: optionalText,
    ipCity: optionalText,
    deviceId: optionalText,
    accountsOnDevice: zeroMeansMissing,
    previousIpAddress: optionalText,
  },
  { required_error: 'context zorunlu' },
);

type ParsedContext = z.infer<typeof contextSchema>;

/**
 * undefined degerli anahtarlari atar: "yok" alan domain nesnesinde hic durmaz.
 * Buradaki `as` VERI DOGRULAMAZ (veri zaten semadan gecti); yalnizca
 * Object.fromEntries'in genis donus tipini daraltan tip tesisatidir.
 */
function present<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

function toRiskContext(parsed: ParsedContext): RiskContext {
  return {
    userId: parsed.userId,
    deliveredOrderCount: parsed.deliveredOrderCount,
    cancelledOrderCount: parsed.cancelledOrderCount,
    ...present({
      orderId: parsed.orderId,
      marketId: parsed.marketId,
      accountCreatedAt: parsed.accountCreatedAt,
      basketTotalMinor: parsed.basketTotal?.amountMinor,
      userAverageBasketMinor: parsed.userAverageBasket?.amountMinor,
      checkoutDwellMs: parsed.checkoutDwellMs,
      deliveryLocation: parsed.deliveryLocation,
      sessionLocation: parsed.sessionLocation,
      ipAddress: parsed.ipAddress,
      ipCity: parsed.ipCity,
      deviceId: parsed.deviceId,
      accountsOnDevice: parsed.accountsOnDevice,
      previousIpAddress: parsed.previousIpAddress,
    }),
  };
}

export const evaluateRequestSchema = z
  .object({ context: contextSchema })
  .transform(({ context }) => toRiskContext(context));

export const getLastEvaluationRequestSchema = z
  .object({ userId: requiredText('userId'), orderId: optionalText })
  .transform(({ userId, orderId }) => (orderId === undefined ? { userId } : { userId, orderId }));

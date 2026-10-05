/**
 * gRPC istek semalari (Zod): proto mesajini use-case girdisine cevirir.
 *
 * Kimlikler sozlesmedeki bicimle denetlenir (@getir/contracts): siparis
 * ord_<32 hex>, market mkt_<govde>, kurye crr_<32 hex>. Kullanimdan kalkan
 * dark_store_id OKUNMAZ (proto yorumu, ADR-15); market_id zorunludur.
 * Gonderilmeyen mesaj (teslimat konumu) proto'dan undefined gelir ve
 * reddedilir.
 */

import { geoPointSchema, marketIdSchema, orderIdSchema } from '@getir/contracts';
import { ID_PREFIX, isId } from '@getir/core';
import { z } from 'zod';

import type { AssignCourierCommand } from '../../application/assign-courier.js';
import type { StartRouteCommand } from '../../application/start-route.js';

const courierIdSchema = z
  .string()
  .refine((value) => isId(ID_PREFIX.COURIER, value), { message: 'kurye kimligi bekleniyor' });

export const assignCourierRequestSchema = z
  .object({
    orderId: orderIdSchema,
    marketId: marketIdSchema,
    deliveryLocation: geoPointSchema,
  })
  .transform(({ orderId, marketId, deliveryLocation }): AssignCourierCommand => ({
    orderId,
    marketId,
    deliveryLocation: { lat: deliveryLocation.lat, lng: deliveryLocation.lng },
  }));

export const getCourierRequestSchema = z
  .object({ courierId: courierIdSchema })
  .transform(({ courierId }) => courierId);

export const startRouteRequestSchema = z
  .object({ orderId: orderIdSchema, courierId: courierIdSchema })
  .transform(({ orderId, courierId }): StartRouteCommand => ({ orderId, courierId }));

export const releaseCourierRequestSchema = z
  .object({ orderId: orderIdSchema })
  .transform(({ orderId }) => orderId);

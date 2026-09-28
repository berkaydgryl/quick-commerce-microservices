/**
 * Siparis durumu semasi.
 *
 * TEK KAYNAK @getir/core icindeki ORDER_STATUS'tur; liste burada tekrar
 * YAZILMAZ. Durum makinesine yeni bir dugum eklendiginde bu sema kendiliginden
 * genisler.
 *
 * NEDEN AYRI DOSYA (T7.5): hem rezervasyon cevabi (cart.ts) hem siparis
 * semalari (order.ts) durumu tasir ve order.ts zaten cart.ts'i import eder;
 * sema order.ts'te kalsaydi iki dosya birbirini import ederdi.
 */

import { ORDER_STATUS } from '@getir/core';
import { z } from 'zod';

export const orderStatusSchema = z.nativeEnum(ORDER_STATUS);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

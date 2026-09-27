/**
 * Siparis deposunun YAZMA/OKUMA arayuzu (port).
 *
 * Iki uygulamasi var: bellek (MOCK) ve Mongo (T4.5). Ikisi de ayni sozlesme
 * testinden gecer (test/support/order-repository-contract.ts). Kullanicinin
 * siparis gecmisi ayri porttadir (order-history-reader.ts): taslak acan ya da
 * iptal eden use-case liste sorgusunu bilmek zorunda kalmasin.
 */

import { AppError } from '@getir/core';

import type { OrderEvent } from './order-events.js';
import type { Order } from './order.js';

/**
 * OLAYLAR ZORUNLU PARAMETRE (T7.3, ADR-04): siparis ve urettigi olaylar TEK
 * atomik yazimdir - biri yazilmazsa digeri de yazilmaz. Olay uretmeyen yazim
 * `[]` gecer; parametreyi unutan kod derlenmez.
 */
export interface OrderRepository {
  /**
   * YENI siparisi ve olaylarini yazar.
   * @throws AppError CONFLICT - ayni kimlikte kayit zaten var (olaylar da yazilmaz).
   */
  insert(order: Order, events: readonly OrderEvent[]): Promise<void>;

  /**
   * Var olan siparisin yerine `order`'i yazar ve olaylari ekler; YALNIZCA
   * kayittaki surum `expectedVersion` ise. Arada baska bir yazma olduysa
   * hicbir sey yazmaz - olaylar dahil.
   * @throws AppError CONFLICT - kayit yok ya da surum degismis.
   */
  update(order: Order, expectedVersion: number, events: readonly OrderEvent[]): Promise<void>;

  /** Kimlige gore okur; yoksa null. */
  findById(orderId: string): Promise<Order | null>;
}

/**
 * Depo sozlesmesinin iki hatasi. Iki uygulama da (bellek, Mongo) bunlari
 * firlatir; cagiran taraf hangi deponun calistigini bilmeden ayni kodu gorur.
 */
export function orderAlreadyExists(orderId: string): AppError {
  return AppError.conflict('Siparis zaten var', { details: { orderId } });
}

export function orderVersionConflict(orderId: string, expectedVersion: number): AppError {
  return AppError.conflict('Siparis baska bir istekle degisti; tekrar deneyin', {
    details: { orderId, expectedVersion },
  });
}

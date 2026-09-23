/**
 * Siparis deposunun YAZMA/OKUMA arayuzu (port).
 *
 * Iki uygulamasi var: bellek (MOCK) ve Mongo (T4.5). Ikisi de ayni sozlesme
 * testinden gecer (test/support/order-repository-contract.ts). Kullanicinin
 * siparis gecmisi ayri porttadir (order-history-reader.ts): taslak acan ya da
 * iptal eden use-case liste sorgusunu bilmek zorunda kalmasin.
 */

import { AppError } from '@getir/core';

import type { Order } from './order.js';

export interface OrderRepository {
  /**
   * YENI siparisi yazar.
   * @throws AppError CONFLICT - ayni kimlikte kayit zaten var.
   */
  insert(order: Order): Promise<void>;

  /**
   * Var olan siparisin yerine `order`'i yazar; YALNIZCA kayittaki surum
   * `expectedVersion` ise. Arada baska bir yazma olduysa hicbir sey yazmaz.
   * @throws AppError CONFLICT - kayit yok ya da surum degismis.
   */
  update(order: Order, expectedVersion: number): Promise<void>;

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

/**
 * Siparis alaninin (domain) varliklari ve saf kurallari.
 *
 * KURAL: bu dosya DISARI BAKMAZ - mongodb, ioredis, grpc ya da uretilen proto
 * tipi importu yoktur. @getir/core bir istisna degil, PAYLASILAN CEKIRDEKTIR:
 * saf TypeScript, I/O icermez ve siparis durumlari (ORDER_STATUS) zaten
 * servisler arasi ortak sozlukte tanimlidir.
 *
 * KAPSAM (T3.2): burasi iskelet. Tam gecis tablosu ve timeline yazimi T4.4'un,
 * Mongo kalicilik T4.5'in isidir. Bugun yalnizca taslak siparisin dogusu ve
 * odemeye gecis adimi var.
 */

import { AppError, ERROR_CODES, ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import type { Clock, OrderStatus } from '@getir/core';

/** Sepetten gelen ham satir. FIYAT TASIMAZ (istemciden gelen fiyata guvenilmez). */
export interface CartLine {
  readonly productId: string;
  readonly sku: string;
  readonly quantity: number;
}

export interface DeliveryLocation {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Siparis kaydi (iskelet hali).
 *
 * Kalemler bugun HAM SEPET satiri olarak duruyor; fiyati dondurulmus OrderItem
 * ve toplamlar, fiyatlandirma paketi (T4.3) ile katalog fiyatlarinin okunmasi
 * geldiginde olusacak. Bugun tutar hesaplamak, sonradan atilacak bir kod
 * yazmak olurdu.
 */
export interface Order {
  readonly id: string;
  readonly userId: string;
  readonly darkStoreId: string;
  readonly lines: readonly CartLine[];
  readonly deliveryLocation: DeliveryLocation;
  readonly deliveryAddress: string;
  readonly status: OrderStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DraftOrderInput {
  readonly userId: string;
  readonly darkStoreId: string;
  readonly lines: readonly CartLine[];
  readonly deliveryLocation: DeliveryLocation;
  readonly deliveryAddress: string;
}

/**
 * Yeni taslak siparis uretir.
 *
 * KIMLIK BURADA URETILIR (B8): rezervasyon, henuz olmayan bir siparisin
 * kimligiyle acilamaz; once order-service DRAFT siparisi acar ve kimligi verir.
 * Zaman `Clock` uzerinden okunur - is mantigi icinde Date.now() cagrilmaz,
 * boylece testte saat sabitlenebilir.
 */
export function createDraftOrder(input: DraftOrderInput, clock: Clock): Order {
  const now = clock.date();

  return {
    id: newId(ID_PREFIX.ORDER),
    userId: input.userId,
    darkStoreId: input.darkStoreId,
    lines: input.lines,
    deliveryLocation: input.deliveryLocation,
    deliveryAddress: input.deliveryAddress,
    status: ORDER_STATUS.DRAFT,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Odeme adimina gecmeye uygun mu?
 *
 * T3.2 ISKELETI: yalnizca DRAFT kabul edilir. Gercek gecis tablosu (RISK_CHECK,
 * REVIEW, RESERVED, telafi yollari) T4.4'te gelecek; o gun bu fonksiyon
 * tablodan okuyan genel bir "gecis uygulayicisi" ile degistirilecek.
 *
 * Tablo disi gecis SESSIZCE GECILMEZ: ORDER_STATE_INVALID firlatir ve bu kod
 * gRPC tarafinda FAILED_PRECONDITION'a cevrilir.
 */
export function assertCanStartPayment(order: Order): void {
  if (order.status !== ORDER_STATUS.DRAFT) {
    throw new AppError(
      ERROR_CODES.ORDER_STATE_INVALID,
      `Bu durumdaki siparis odemeye gecemez: ${order.status}`,
      { details: { orderId: order.id, status: order.status } },
    );
  }
}

/** Durumu degistirilmis YENI siparis nesnesi dondurur (mutasyon yok). */
export function withStatus(order: Order, status: OrderStatus, clock: Clock): Order {
  return { ...order, status, updatedAt: clock.date() };
}

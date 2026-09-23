/**
 * PaymentRepository portunun Mongo uygulamasi: domain <-> belge cevirisi ve
 * depo sozlesmesinin hatalari. Sorgu yazmaz; sorgular payments-collection.ts'te.
 *
 * Bellek uygulamasiyla ayni sozlesme testinden gecer
 * (test/support/payment-store-contract.ts): iki depo ayni hatayi verir.
 */

import { ERROR_CODES, isAppError } from '@getir/core';

import type { Payment } from '../../domain/payment.js';
import type { PaymentRepository } from '../../domain/payment-repository.js';
import {
  paymentAlreadyExists,
  paymentNotFound,
  paymentVersionConflict,
} from '../../domain/payment-repository.js';
import { fromPaymentDocument, toPaymentDocument } from './mappers.js';
import type { PaymentsCollection } from './payments-collection.js';

export class PaymentMongoStore implements PaymentRepository {
  constructor(private readonly payments: PaymentsCollection) {}

  async insert(payment: Payment): Promise<void> {
    try {
      await this.payments.insertOne(toPaymentDocument(payment));
    } catch (error: unknown) {
      // mongo-kit tekil ihlali CONFLICT'e cevirir (orderId ya da anahtar);
      // bellek uygulamasiyla ayni ayrintiyi veriyoruz.
      throw isAppError(error) && error.code === ERROR_CODES.CONFLICT
        ? paymentAlreadyExists(payment.orderId)
        : error;
    }
  }

  async update(payment: Payment, expectedVersion: number): Promise<void> {
    const replaced = await this.payments.replaceIfVersion(
      toPaymentDocument(payment),
      expectedVersion,
    );
    if (replaced) {
      return;
    }
    // Yalnizca basarisiz yolda ek okuma: "kayit yok" ile "surum degismis"
    // ayri hatalardir; use-case surum cakismasinda yeniden okur, digerinde okumaz.
    const exists = (await this.payments.findById(payment.id)) !== null;
    throw exists
      ? paymentVersionConflict(payment.orderId, expectedVersion)
      : paymentNotFound(payment.orderId);
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    const document = await this.payments.findByOrderId(orderId);
    return document === null ? null : fromPaymentDocument(document);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    const document = await this.payments.findByIdempotencyKey(idempotencyKey);
    return document === null ? null : fromPaymentDocument(document);
  }
}

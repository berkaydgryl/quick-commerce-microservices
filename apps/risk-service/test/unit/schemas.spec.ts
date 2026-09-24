/**
 * "0 mi, yok mu?" (T6.3 karari): proto3 varsayilanlari domain'e dogru anlamla
 * gecmeli. En kritik durum: gonderilmeyen bekleme suresi (0) herkesi bot
 * yapmamali.
 */

import { riskV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import {
  evaluateRequestSchema,
  getLastEvaluationRequestSchema,
} from '../../src/interfaces/grpc/schemas.js';

/** Yalnizca kullanici kimligi dolu, gerisi proto varsayilani (0 / ""). */
const bare = (overrides: Partial<riskV1.RiskContext> = {}): riskV1.EvaluateRequest => ({
  context: { ...riskV1.RiskContext.fromPartial({}), userId: 'usr_1', ...overrides },
});

describe('evaluateRequestSchema', () => {
  it('checkoutDwellMs 0 ve accountsOnDevice 0 "olculmedi" sayilir: alan hic yazilmaz', () => {
    const context = evaluateRequestSchema.parse(bare());

    expect('checkoutDwellMs' in context).toBe(false);
    expect('accountsOnDevice' in context).toBe(false);
  });

  it('siparis sayilari 0 GERCEKTEN 0 dir (yeni uyenin 0 teslimati gercek sinyal)', () => {
    const context = evaluateRequestSchema.parse(bare());

    expect(context.deliveredOrderCount).toBe(0);
    expect(context.cancelledOrderCount).toBe(0);
  });

  it('bos metinler ve gonderilmeyen mesajlar yok sayilir', () => {
    const context = evaluateRequestSchema.parse(bare());

    expect(Object.keys(context).sort()).toEqual([
      'cancelledOrderCount',
      'deliveredOrderCount',
      'userId',
    ]);
  });

  it('dolu degerler aynen gecer; tutar kurus olarak alinir', () => {
    const context = evaluateRequestSchema.parse(
      bare({
        orderId: 'ord_1',
        checkoutDwellMs: 1200,
        accountsOnDevice: 4,
        ipAddress: '10.0.0.2',
        previousIpAddress: '10.0.0.1',
        basketTotal: { amountMinor: 90_000, currency: 'TRY' },
        deliveryLocation: { lat: 40.98, lng: 29.02 },
      }),
    );

    expect(context).toMatchObject({
      orderId: 'ord_1',
      checkoutDwellMs: 1200,
      accountsOnDevice: 4,
      ipAddress: '10.0.0.2',
      previousIpAddress: '10.0.0.1',
      basketTotalMinor: 90_000,
      deliveryLocation: { lat: 40.98, lng: 29.02 },
    });
  });

  it('kullanimdan kalkan darkStoreId okunmaz', () => {
    expect('darkStoreId' in evaluateRequestSchema.parse(bare({ darkStoreId: 'ds_1' }))).toBe(false);
  });

  it.each([
    ['baglam yok', { context: undefined }],
    ['kullanici bos', bare({ userId: ' ' })],
    ['negatif sayi', bare({ deliveredOrderCount: -1 })],
    ['enlem disi', bare({ deliveryLocation: { lat: 91, lng: 29 } })],
  ])('reddeder: %s', (_, request) => {
    expect(evaluateRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('getLastEvaluationRequestSchema', () => {
  it('bos siparis kimligi "kullanicinin son degerlendirmesi" demektir', () => {
    expect(getLastEvaluationRequestSchema.parse({ userId: 'usr_1', orderId: '' })).toEqual({
      userId: 'usr_1',
    });
    expect(getLastEvaluationRequestSchema.parse({ userId: 'usr_1', orderId: 'ord_1' })).toEqual({
      userId: 'usr_1',
      orderId: 'ord_1',
    });
  });

  it('kullanici zorunlu', () => {
    expect(getLastEvaluationRequestSchema.safeParse({ userId: '', orderId: '' }).success).toBe(
      false,
    );
  });
});

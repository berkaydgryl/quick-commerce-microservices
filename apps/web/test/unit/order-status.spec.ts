/**
 * Siparis durumunun gosterim grubu (T11.16): 13 dugum uc gruba iner;
 * iade, iptal + gecmiste PAID (gateway ozetiyle ayni kural).
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { OrderStatus } from '@getir/contracts';
import { ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  statusGroup,
  statusLabel,
  wasRefunded,
} from '../../src/features/orders/services/order-status';

const TEXTS = CONTENT_FALLBACK.orders;

describe('order-status (T11.16)', () => {
  it('gruplar: teslim tamam; odeme, risk, hazirlik, yol suruyor; iptal, ret, odeme hatasi, sure doldu iptal', () => {
    const groups = Object.fromEntries(
      Object.values(ORDER_STATUS).map((status) => [status, statusGroup(status)]),
    );

    expect(groups).toEqual({
      DRAFT: 'inProgress',
      RISK_CHECK: 'inProgress',
      REVIEW: 'inProgress',
      RESERVED: 'inProgress',
      AWAITING_PAYMENT: 'inProgress',
      PAID: 'inProgress',
      PREPARING: 'inProgress',
      ON_THE_WAY: 'inProgress',
      DELIVERED: 'completed',
      CANCELLED: 'cancelled',
      REJECTED: 'cancelled',
      PAYMENT_FAILED: 'cancelled',
      EXPIRED: 'cancelled',
    });
  });

  it('grup etiketleri icerikten', () => {
    expect(statusLabel(TEXTS, 'completed')).toBe('Tamamlandı');
    expect(statusLabel(TEXTS, 'inProgress')).toBe('Devam ediyor');
    expect(statusLabel(TEXTS, 'cancelled')).toBe('İptal edildi');
  });

  it('iade: durum CANCELLED ve gecmiste PAID', () => {
    const timeline = (...statuses: OrderStatus[]) =>
      statuses.map((status) => ({ status, at: '2026-10-05T12:00:00.000Z' }));

    expect(
      wasRefunded({ status: 'CANCELLED', timeline: timeline('DRAFT', 'PAID', 'CANCELLED') }),
    ).toBe(true);
    expect(wasRefunded({ status: 'CANCELLED', timeline: timeline('DRAFT', 'CANCELLED') })).toBe(
      false,
    );
    expect(
      wasRefunded({ status: 'PAYMENT_FAILED', timeline: timeline('PAID', 'PAYMENT_FAILED') }),
    ).toBe(false);
    expect(wasRefunded({ status: 'DELIVERED', timeline: timeline('PAID', 'DELIVERED') })).toBe(
      false,
    );
  });
});

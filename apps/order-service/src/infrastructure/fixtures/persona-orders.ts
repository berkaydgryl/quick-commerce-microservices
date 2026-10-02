/**
 * Demo personalarinin siparis gecmisi (roadmap "Test personalari"; T8.1).
 *
 * risk-svc'nin order-history ve basket-anomaly kurallari bu gecmisten beslenir:
 * teslim edilen ve iptal edilen siparis sayilari ile teslim edilenlerin
 * ortalama tutari (OrderHistoryReader.riskHistory). Degerler risk-svc'nin
 * persona testindekilerle ayni (test/support/personas.ts):
 *
 *   Ayse   5 teslim, 0 iptal, ortalama 200 TL -> temiz
 *   Zeynep hic siparis yok                   -> "hic teslimat yok"
 *   Can    1 teslim, 3 iptal, ortalama 120 TL -> iptal orani %75; 360 TL ustu
 *                                              sepet "3 kat" anomalisidir
 *   Ali    3 teslim, 1 iptal, ortalama 180 TL -> temiz (vetosu cihazdan)
 *   Komsu 12 teslim, 1 iptal, ortalama 280 TL -> temiz
 *
 * Kullanici kimlikleri gateway'in persona dosyasiyla AYNI
 * (apps/gateway/internal/persona/personas.json); hesaplari gateway yazar,
 * siparisleri bu servis (ADR-05). Iki dosyayi gateway'in persona testi
 * karsilastirir.
 *
 * YALNIZCA yerel ve MOCK: seed ve bellek yuklemesi production'da reddedilir.
 */

import { createHash } from 'node:crypto';

import { ID_PREFIX, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import type { OrderStatus } from '@getir/core';

import type { OrderItem } from '../../domain/order-item.js';
import { ITEM_UNIT } from '../../domain/order-item.js';
import type { Order, TimelineEntry } from '../../domain/order.js';
import { TIMELINE_NOTE } from '../../domain/order.js';

interface PersonaHistory {
  /** Gunlukte ve testte gorunen ad. */
  readonly persona: string;
  readonly userId: string;
  /** Teslim edilen siparislerin tutarlari (kurus); ortalama bunlardan cikar. */
  readonly deliveredTotalsMinor: readonly number[];
  readonly cancelledCount: number;
}

/** Personalarin kimlikleri ve gecmisleri. */
export const PERSONA_HISTORIES: readonly PersonaHistory[] = [
  {
    persona: 'Ayse',
    userId: 'usr_a9e0eddcc7fe5bf4c620ae453c227c6a',
    deliveredTotalsMinor: [18_000, 19_000, 20_000, 21_000, 22_000],
    cancelledCount: 0,
  },
  {
    persona: 'Zeynep',
    userId: 'usr_7ba4ba2d91bb51133bf18ef64e49bc5e',
    deliveredTotalsMinor: [],
    cancelledCount: 0,
  },
  {
    persona: 'Can',
    userId: 'usr_41098a7bffad8e43cdb031102b61debe',
    deliveredTotalsMinor: [12_000],
    cancelledCount: 3,
  },
  {
    persona: 'Ali',
    userId: 'usr_68dd28754d4cdc3657e26627d25dad38',
    deliveredTotalsMinor: [17_000, 18_000, 19_000],
    cancelledCount: 1,
  },
  {
    persona: 'Komsu',
    userId: 'usr_f0c2cae267283f94a5b5e2ea5ea4be54',
    deliveredTotalsMinor: [
      26_000, 27_000, 28_000, 29_000, 30_000, 28_000, 28_000, 27_000, 29_000, 28_000, 26_000,
      30_000,
    ],
    cancelledCount: 1,
  },
];

/** Gecmis siparislerin verildigi market ve adres: hazir "Ev" adresi (Kadikoy). */
const HISTORY_MARKET_ID = 'mkt_migros-jet-moda';
const HOME = {
  line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
  location: { lat: 40.9885, lng: 29.0262 },
} as const;
const CURRENCY = 'TRY';

/** Gecmis siparisin tek kalemi: tutar kalemden gelir (teslimat ucretsiz, indirim yok). */
const HISTORY_ITEM = {
  productId: 'prd_haftalik-alisveris',
  sku: 'DEMO-GECMIS',
  name: 'Haftalık alışveriş (demo geçmişi)',
  unit: ITEM_UNIT.PACK,
} as const;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Gecmis siparisler arasi gun: en yenisi 2 gun once. */
const DAYS_BETWEEN_ORDERS = 3;

/** Teslim edilen siparisin gectigi durumlar ve siparisin acilisindan dakika. */
const DELIVERED_PATH: readonly (readonly [OrderStatus, number, string?])[] = [
  [ORDER_STATUS.DRAFT, 0],
  [ORDER_STATUS.RISK_CHECK, 1],
  [ORDER_STATUS.RESERVED, 1],
  [ORDER_STATUS.AWAITING_PAYMENT, 1],
  [ORDER_STATUS.PAID, 2],
  [ORDER_STATUS.PREPARING, 5],
  [ORDER_STATUS.ON_THE_WAY, 15],
  [ORDER_STATUS.DELIVERED, 35],
];

/** Iptal edilen siparis: kullanici taslagi iptal etti. */
const CANCELLED_PATH: readonly (readonly [OrderStatus, number, string?])[] = [
  [ORDER_STATUS.DRAFT, 0],
  [ORDER_STATUS.CANCELLED, 2, TIMELINE_NOTE.USER_CANCELLED],
];

/** Personalarin kullanici kimlikleri (seed eski gecmisi bunlarla siler). */
export function personaUserIds(): readonly string[] {
  return PERSONA_HISTORIES.map((history) => history.userId);
}

/**
 * Butun personalarin gecmis siparislerini now'a gore kurar. Kimlikler
 * BELIRLENIMCIDIR (persona + sira): seed tekrar kosunca ayni siparisler
 * yazilir, ikinci kopya olusmaz.
 */
export function buildPersonaOrders(now: Date): readonly Order[] {
  return PERSONA_HISTORIES.flatMap((history) => {
    const delivered = history.deliveredTotalsMinor.map((total) => ({
      status: ORDER_STATUS.DELIVERED,
      total,
    }));
    const cancelled = Array.from({ length: history.cancelledCount }, (_, index) => ({
      status: ORDER_STATUS.CANCELLED,
      // Iptal edilen sepet de gercekci bir tutar tasir; ortalamaya girmez.
      total: history.deliveredTotalsMinor[index] ?? 15_000,
    }));
    return [...delivered, ...cancelled].map((entry, index) =>
      buildOrder(history, index, entry.status, entry.total, now),
    );
  });
}

function buildOrder(
  history: PersonaHistory,
  index: number,
  status: OrderStatus,
  totalMinor: number,
  now: Date,
): Order {
  const createdAt = new Date(now.getTime() - (2 + index * DAYS_BETWEEN_ORDERS) * DAY_MS);
  const path = status === ORDER_STATUS.DELIVERED ? DELIVERED_PATH : CANCELLED_PATH;
  const timeline: TimelineEntry[] = path.map(([step, minutes, note]) => ({
    status: step,
    at: new Date(createdAt.getTime() + minutes * MINUTE_MS),
    ...(note === undefined ? {} : { note }),
  }));
  const item: OrderItem = {
    ...HISTORY_ITEM,
    quantity: 1,
    unitPriceMinor: totalMinor,
    lineTotalMinor: totalMinor,
  };
  return {
    id: personaOrderId(history.userId, index),
    userId: history.userId,
    marketId: HISTORY_MARKET_ID,
    items: [item],
    pricing: {
      currency: CURRENCY,
      subtotalMinor: totalMinor,
      deliveryFeeMinor: 0,
      discountMinor: 0,
      totalMinor,
    },
    deliveryLocation: HOME.location,
    deliveryAddress: HOME.line,
    status,
    timeline,
    // Teslim edilen siparis risk adimindan dusuk bantla gecmistir; taslakken
    // iptal edilen hic risk adimina girmemistir.
    ...(status === ORDER_STATUS.DELIVERED ? { riskBand: RISK_BANDS.LOW } : {}),
    createdAt,
    updatedAt: timeline[timeline.length - 1]?.at ?? createdAt,
    version: timeline.length,
  };
}

/** ord_ + 32 hex, persona ve siradan turetilir (@getir/core kimlik bicimi). */
function personaOrderId(userId: string, index: number): string {
  const body = createHash('sha256')
    .update(`persona-order:${userId}:${index}`)
    .digest('hex')
    .slice(0, 32);
  return `${ID_PREFIX.ORDER}_${body}`;
}

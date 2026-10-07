/**
 * Kurye takibi (T13.3, asama 1): GET /v1/orders/{orderId}/tracking. Web
 * siparis ayrintisinda 3 adimli takibi ve "Kuryem nerede" haritasini bununla
 * cizer; asama 1'de 2 saniyede bir yoklar (asama 2'de canli akis sokettir).
 *
 * Konum ve kalanlar courier'da ZAMANDAN hesaplanir (rota atamada uretilir,
 * kurye hizi ve marketteki hazirlik suresiyle ilerler); her cagri o anin
 * degerini verir. 3 adimli takip `phase`'i izler (hareketin kaynagi courier);
 * `status` order'in kaydidir, olaylar islenene kadar birkac saniye geride
 * kalabilir.
 *
 * Gateway once sahipligi order'dan dogrular (baskasinin siparisi 404). Takip
 * yoksa (kurye henuz atanmadi, rota birakildi ya da T13.3 oncesi siparis) yine
 * 404: web yalnizca siparis ayrintisinda kurye varken yoklar ve 404'te,
 * DELIVERED'da ya da siparis son durumdayken yoklamayi BIRAKIR.
 */

import { ORDER_STATUS } from '@getir/core';
import { z } from 'zod';

import { courierIdSchema, geoPointSchema, isoDateTimeSchema, orderIdSchema } from './common.js';

/**
 * Kurye yaklasti: paket ALINDIKTAN sonra (TO_CUSTOMER) teslimat adresine kalan
 * yol bu kadar ya da az. Web bu esikte kullaniciya BIR KEZ bildirir (karar M4
 * a); isCourierApproaching tek kaynaktir.
 */
export const COURIER_APPROACHING_METERS = 300;

/**
 * Takipte gosterilen rotanin en cok nokta sayisi: courier rotayi en fazla 40
 * noktayla uretir (T13.2), takip bunun market -> adres parcasini verir.
 * courier-service bu sabiti buradan okur.
 */
export const COURIER_ROUTE_MAX_POINTS = 40;

/** Paket alinmadan (TO_MARKET) varis tahmini bu adimla, yukari yuvarlanir. */
export const TRACKING_ETA_STEP_BEFORE_PICKUP_SECONDS = 60;

/**
 * Takibin asamasi.
 *   TO_MARKET   : kurye markete gidiyor ya da markette hazirlik bitmesini bekliyor
 *                 (siparis PREPARING; adim "Hazirlaniyor").
 *   TO_CUSTOMER : paket alindi, kurye adrese gidiyor (ON_THE_WAY; "Kurye yolda").
 *   DELIVERED   : rota bitti (DELIVERED; "Teslim edildi").
 */
export const trackingPhaseSchema = z.enum(['TO_MARKET', 'TO_CUSTOMER', 'DELIVERED']);

/** Takibin gosterildigi siparis durumlari; iptal edilmis siparisin takibi yoktur. */
export const trackedOrderStatusSchema = z.enum([
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.ON_THE_WAY,
  ORDER_STATUS.DELIVERED,
]);

type TrackingShape = {
  readonly phase: z.infer<typeof trackingPhaseSchema>;
  readonly location?: unknown;
  readonly remainingMeters: number;
  readonly etaSeconds: number;
  readonly pickedUpAt?: string | undefined;
  readonly deliveredAt?: string | undefined;
};

function issue(context: z.RefinementCtx, path: string, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
}

/**
 * Asamanin kurallari.
 *
 * GIZLILIK (guvenlik incelemesi): kurye bir teslimattan sonra oldugu yerde,
 * yani ONCEKI musterinin adresinde bosa cikar ve oradan yeni siparise atanir.
 * Bu yuzden paket alinmadan (TO_MARKET) kuryenin konumu YOK, rota market ->
 * adres parcasidir, kalan yol yalnizca 2. bacaktir (kurye -> market mesafesi
 * verilmez) ve varis tahmini dakikaya yukari yuvarlanir (kalanin azalisi
 * kuryenin markete uzakligini ele vermesin).
 *
 * Tutarlilik: TO_MARKET'ta alma ve teslim ani yok; TO_CUSTOMER'da alma ani var,
 * teslim ani yok; DELIVERED'da ikisi de var, kalan yol ve sure 0.
 */
export function enforceTrackingPhase(value: TrackingShape, context: z.RefinementCtx): void {
  const pickedUp = value.phase !== 'TO_MARKET';
  if (pickedUp !== (value.location !== undefined)) {
    issue(context, 'location', pickedUp ? 'konum zorunlu' : 'paket alinmadan konum verilmez');
  }
  if (pickedUp !== (value.pickedUpAt !== undefined)) {
    issue(context, 'pickedUpAt', 'alma ani asamayla uyusmuyor');
  }
  if ((value.phase === 'DELIVERED') !== (value.deliveredAt !== undefined)) {
    issue(context, 'deliveredAt', 'teslim ani asamayla uyusmuyor');
  }
  if (value.phase === 'DELIVERED' && (value.remainingMeters !== 0 || value.etaSeconds !== 0)) {
    issue(context, 'remainingMeters', 'teslim edildiyse kalan 0');
  }
  if (
    value.phase === 'TO_MARKET' &&
    value.etaSeconds % TRACKING_ETA_STEP_BEFORE_PICKUP_SECONDS !== 0
  ) {
    issue(context, 'etaSeconds', 'paket alinmadan tahmin dakikaya yuvarlanir');
  }
}

/** GET /v1/orders/{orderId}/tracking cevabi. */
export const orderTrackingSchema = z
  .object({
    orderId: orderIdSchema,
    /** Order'in kaydi: PREPARING, ON_THE_WAY ya da DELIVERED (`phase`'in birkac saniye gerisinde olabilir). */
    status: trackedOrderStatusSchema,
    phase: trackingPhaseSchema,
    courier: z.object({
      id: courierIdSchema,
      /** Gosterim adi ("Mehmet K."); gercek kisi degil. */
      name: z.string().min(1),
    }),
    /** Kuryenin o anki konumu: TO_MARKET'ta YOK (gizlilik), sonra zorunlu. */
    location: geoPointSchema.optional(),
    /** Degerlerin hesaplandigi an. */
    at: isoDateTimeSchema,
    /** Teslimat adresine kalan yol, metre; TO_MARKET'ta 2. bacagin tamami. */
    remainingMeters: z.number().int().min(0),
    /** Teslimata kalan, saniye (yukari yuvarlanir); TO_MARKET'ta dakikaya. */
    etaSeconds: z.number().int().min(0),
    /**
     * Rotanin market -> adres parcasi: ilk nokta market, son nokta adres
     * (adres marketin kendisiyse tek nokta).
     */
    route: z.array(geoPointSchema).min(1).max(COURIER_ROUTE_MAX_POINTS),
    marketLocation: geoPointSchema,
    deliveryLocation: geoPointSchema,
    pickedUpAt: isoDateTimeSchema.optional(),
    deliveredAt: isoDateTimeSchema.optional(),
  })
  .superRefine(enforceTrackingPhase);

/**
 * Kurye yaklasti mi: paket alinmis (TO_CUSTOMER) ve kalan yol esikte ya da
 * altinda. Markette beklerken (TO_MARKET) adres yakin olsa da yaklasma DEGILDIR.
 */
export function isCourierApproaching(tracking: {
  readonly phase: z.infer<typeof trackingPhaseSchema>;
  readonly remainingMeters: number;
}): boolean {
  return tracking.phase === 'TO_CUSTOMER' && tracking.remainingMeters <= COURIER_APPROACHING_METERS;
}

export type TrackingPhase = z.infer<typeof trackingPhaseSchema>;
export type TrackedOrderStatus = z.infer<typeof trackedOrderStatusSchema>;
export type OrderTracking = z.infer<typeof orderTrackingSchema>;

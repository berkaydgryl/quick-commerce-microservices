/**
 * Dinleme arayuzu (ADR-07, T7.4). Servis kodu yalnizca
 * subscribe(topic, group, handler) gorur; tasima (bugun Redis Streams)
 * fabrikada secilir.
 *
 * GRUP = "bu olaylari kim isler" (servis adi). Bir grubun her olayi grubun TEK
 * bir tuketicisine gider: ayni servisin kopyalari isi paylasir. Farkli gruplar
 * ayni olayi ayri ayri alir (payment ve realtime ayni siparis olayini gorur).
 *
 * Teslimat EN AZ BIR KEZDIR (ADR-04): isleyici ayni olayi iki kez gorebilir,
 * bu yuzden tekrar-guvenli yazilir (eventId ya da is anahtariyla).
 */

import type { EventName, Logger } from '@getir/core';

import type { EventEnvelope } from './envelope.js';

export interface EventDelivery {
  /** Kacinci teslim: 1 ilk teslimdir; gecici hatadan sonraki her teslimde artar. */
  readonly attempt: number;
  /** eventId, topic, grup ve deneme bagli gunlukcu. */
  readonly logger: Logger;
}

/**
 * Isleyicinin cevabi.
 *
 * - `handled`: olay onaylanir, bir daha gelmez.
 * - `rejected`: tekrar denemek sonucu DEGISTIRMEZ (govde bozuk, hedef kayit
 *   yok). Olay beklemeden olu olaylar akisina gider.
 * - Hata FIRLATMAK "gecici" demektir (veritabani kapali): olay onaylanmaz, bir
 *   sure sonra yeniden teslim edilir; deneme hakki bitince olu olaylara gider.
 */
export type EventOutcome =
  | { readonly kind: 'handled' }
  | { readonly kind: 'rejected'; readonly reason: string; readonly cause?: unknown };

export const EVENT_HANDLED: EventOutcome = Object.freeze({ kind: 'handled' as const });

/** Kalici ret: gerekce olu olay kaydina ve ERROR gunlugune yazilir. */
export function rejectEvent(reason: string, cause?: unknown): EventOutcome {
  return cause === undefined ? { kind: 'rejected', reason } : { kind: 'rejected', reason, cause };
}

export type EventHandler = (
  envelope: EventEnvelope,
  delivery: EventDelivery,
) => Promise<EventOutcome>;

export interface EventSubscriber {
  /**
   * Konuyu grup adina dinler. Kayitlar dinleme BASLAMADAN yapilir: grubun
   * okudugu olay, grubun dinledigi hicbir konuya uymuyorsa onaylanip gecilir;
   * kayit sonradan eklenseydi o arada gelen olay kaybolurdu.
   */
  subscribe(topic: EventName, group: string, handler: EventHandler): void;
}

/** Dinlemenin yasam dongusu: once kayitlar, sonra start; kapanista stop. */
export interface EventConsumer extends EventSubscriber {
  start(): Promise<void>;
  /** Yeni okuma baslamaz, eldeki parti bitirilir, baglantilar kapanir. */
  stop(): Promise<void>;
}

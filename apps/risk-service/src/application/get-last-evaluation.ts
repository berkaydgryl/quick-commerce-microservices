/**
 * GetLastEvaluation: kullanicinin (ya da bir siparisin) en son degerlendirmesi.
 * "Bu siparis neden engellendi?" sorusunu tek cagriyla cevaplar. Kayit yoksa
 * NOT_FOUND (sozlesme).
 */

import { AppError } from '@getir/core';

import type { RiskEvent } from '../domain/risk-event.js';
import type { LatestEventQuery, RiskEventRepository } from '../domain/risk-event-repository.js';

export type GetLastEvaluation = (query: LatestEventQuery) => Promise<RiskEvent>;

export function createGetLastEvaluation(events: RiskEventRepository): GetLastEvaluation {
  return async (query) => {
    const event = await events.findLatest(query);
    if (event === null) {
      throw AppError.notFound('Risk degerlendirmesi bulunamadi', {
        details: {
          userId: query.userId,
          ...(query.orderId === undefined ? {} : { orderId: query.orderId }),
        },
      });
    }
    return event;
  };
}

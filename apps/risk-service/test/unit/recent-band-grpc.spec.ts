/**
 * Yapiskan bant (#164) gercek telden: gercek kurallar, gercek gRPC. Zeynep'in ilk
 * degerlendirmesi MEDIUM (35); ayni kullanici temiz sinyallerle hemen tekrar
 * gelir (skor 0) -> cevap MEDIUM ve rules[]'ta puansiz "recent-band" isabeti.
 * 15 dk'dan sonra yapiskanlik biter: skor bandi (LOW) doner.
 */

import { fixedClock } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRiskService } from '../../src/bootstrap.js';
import { RECENT_BAND_WINDOW_MS } from '../../src/config/constants.js';
import { RECENT_BAND_RULE_ID } from '../../src/domain/recent-band.js';
import type { RiskContext } from '../../src/domain/risk-context.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';

const clock = fixedClock(PERSONA_NOW);
let server: TestGrpcServer | undefined;

const zeynep = PERSONAS.find((persona) => persona.name.startsWith('Zeynep'));
const ayse = PERSONAS.find((persona) => persona.name.startsWith('Ayse'));
if (zeynep === undefined || ayse === undefined) throw new Error('persona yok');

/** Zeynep, Ayse'nin temiz sinyalleriyle (skor 0): kullanici ayni, sinyal temiz. */
const zeynepClean: RiskContext = { ...ayse.context, userId: zeynep.context.userId };

async function evaluate(context: RiskContext) {
  if (server === undefined) throw new Error('test sunucusu yok');
  const { error, response } = await server.call(riskV1.RiskServiceService.evaluate, {
    context: toProtoContext(context),
  });
  expect(error).toBeUndefined();
  return response?.evaluation;
}

beforeAll(async () => {
  server = await startTestGrpcServer({
    serviceName: 'risk-yapiskan-bant',
    services: [buildRiskService({ clock })],
  });
});

afterAll(async () => {
  await server?.stop();
});

describe('RiskService/Evaluate: yapiskan bant (#164)', () => {
  it('MEDIUM sonrasi temiz tekrar MEDIUM kalir (skor 0); 15 dk sonra LOW', async () => {
    const first = await evaluate(zeynep.context);
    clock.advance(60_000);
    const retry = await evaluate(zeynepClean);
    clock.advance(RECENT_BAND_WINDOW_MS);
    const later = await evaluate(zeynepClean);

    expect(first?.band).toBe(riskV1.RiskBand.RISK_BAND_MEDIUM);
    expect(retry).toMatchObject({ score: 0, band: riskV1.RiskBand.RISK_BAND_MEDIUM });
    expect(retry?.hits.find((hit) => hit.ruleId === RECENT_BAND_RULE_ID)).toMatchObject({
      hit: true,
      score: 0,
      veto: false,
    });
    expect(later?.band).toBe(riskV1.RiskBand.RISK_BAND_LOW);
    expect(later?.hits.map((hit) => hit.ruleId)).not.toContain(RECENT_BAND_RULE_ID);
  });
});

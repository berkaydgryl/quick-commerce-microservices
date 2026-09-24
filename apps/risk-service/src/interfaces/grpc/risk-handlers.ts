/**
 * RiskService gRPC handler'lari: dogrula -> cagir -> cevir. Is kurali yok;
 * hata cevirisi ve gunlukleme service-kit'in ara katmanindadir.
 */

import type { Logger } from '@getir/core';
import type { riskV1 } from '@getir/proto';
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { EvaluateAndRecord } from '../../application/evaluate-and-record.js';
import type { GetLastEvaluation } from '../../application/get-last-evaluation.js';
import { toProtoEvaluation } from './mappers.js';
import { evaluateRequestSchema, getLastEvaluationRequestSchema } from './schemas.js';

export interface RiskHandlerDeps {
  readonly evaluate: EvaluateAndRecord;
  readonly getLastEvaluation: GetLastEvaluation;
  readonly logger?: Logger;
}

export function createRiskImplementation(deps: RiskHandlerDeps): UntypedServiceImplementation {
  const logger = deps.logger;

  return {
    evaluate: unaryHandler({
      name: 'Evaluate',
      schema: evaluateRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (context): Promise<riskV1.EvaluateResponse> => ({
        evaluation: toProtoEvaluation(await deps.evaluate(context)),
      }),
    }),

    getLastEvaluation: unaryHandler({
      name: 'GetLastEvaluation',
      schema: getLastEvaluationRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (query): Promise<riskV1.GetLastEvaluationResponse> => ({
        evaluation: toProtoEvaluation(await deps.getLastEvaluation(query)),
      }),
    }),
  };
}

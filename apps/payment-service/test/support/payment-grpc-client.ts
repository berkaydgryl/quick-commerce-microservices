/**
 * Gercek payment gRPC sunucusu + gercek istemci: uctan uca testlerin ortak
 * duzenegi (D9). Sunucu, istemci ve tipli cagri @getir/service-kit/testing'den
 * gelir (D5); burada yalnizca payment servisinin kurulumu var.
 */

import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';

import { buildPaymentService } from '../../src/bootstrap.js';
import type { BootstrapOptions } from '../../src/bootstrap.js';

/** Acik servis: tutamak, istemci, tipli cagri ve kapanis (once istemci, sonra sunucu). */
export type RunningPaymentService = TestGrpcServer;

/** Servisi bos portta acar; bagimliliklar verilmezse bellek deposu ve mock saglayici. */
export function startPaymentService(
  options: BootstrapOptions = {},
  serviceName = 'payment-test',
): Promise<RunningPaymentService> {
  return startTestGrpcServer({ serviceName, services: [buildPaymentService(options)] });
}

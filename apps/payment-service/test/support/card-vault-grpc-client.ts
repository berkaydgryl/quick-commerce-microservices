/**
 * Gercek kart kasasi gRPC sunucusu + gercek istemci (T11.17): uctan uca
 * testlerin ortak duzenegi. Bagimliliklar verilmezse bellek deposu ve mock
 * saglayici.
 */

import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';

import { buildCardVaultService } from '../../src/bootstrap.js';
import type { CardVaultOptions } from '../../src/bootstrap.js';

export type RunningCardVault = TestGrpcServer;

export function startCardVault(
  options: CardVaultOptions = {},
  serviceName = 'card-vault-test',
): Promise<RunningCardVault> {
  return startTestGrpcServer({ serviceName, services: [buildCardVaultService(options)] });
}

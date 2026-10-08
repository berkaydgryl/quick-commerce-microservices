/**
 * Gercek kart kasasi gRPC sunucusu + gercek istemci (T11.17): uctan uca
 * testlerin ortak duzenegi. Bagimliliklar verilmezse bellek deposu ve mock
 * saglayici.
 */

import { withoutRandomNoise } from '@getir/core/testing';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import type { ServiceError } from '@grpc/grpc-js';

import { buildCardVaultService } from '../../src/bootstrap.js';
import type { CardVaultOptions } from '../../src/bootstrap.js';

export type RunningCardVault = TestGrpcServer;

export function startCardVault(
  options: CardVaultOptions = {},
  serviceName = 'card-vault-test',
): Promise<RunningCardVault> {
  return startTestGrpcServer({ serviceName, services: [buildCardVaultService(options)] });
}

/**
 * Hatanin disari giden her parcasi: durum metni, mesaj ve x-app-error yuku.
 * Istek kimligi rastgele: kisa sir onun icinde tesadufen gecebilir (maskelenir).
 */
export function visibleError(error: ServiceError | undefined): string {
  return withoutRandomNoise(
    JSON.stringify([
      error?.message,
      error?.details,
      error?.metadata.get('x-app-error').map((value) => value.toString()),
    ]),
  );
}

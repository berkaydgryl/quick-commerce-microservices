/**
 * grpc-js'in kendi gunluk satirlari (D5; D2'de bulundu): dolu porta ikinci
 * sunucu acilirken grpc-js "No address added..." yazar. Bu satir stderr'e duz
 * metin olarak DEGIL, servisin gunlukcusune JSON olarak gider.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startGrpcServer } from '../../src/grpc/server.js';
import type { GrpcServerHandle } from '../../src/grpc/types.js';

let first: GrpcServerHandle | undefined;

afterEach(async () => {
  await first?.shutdown('test bitti');
  first = undefined;
});

describe('grpc-js gunlukleri', () => {
  it('dolu portta grpc-js satiri JSON gunlukcuye WARN olarak gider, stderr bos kalir', async () => {
    first = await startGrpcServer({ serviceName: 'ilk', host: '127.0.0.1', port: 0, services: [] });
    const lines: LogLine[] = [];
    const stderr = vi.spyOn(console, 'error');

    await expect(
      startGrpcServer({
        serviceName: 'ikinci',
        host: '127.0.0.1',
        port: first.port,
        services: [],
        logger: recordingLogger(lines),
      }),
    ).rejects.toThrow('gRPC portu acilamadi');

    expect(lines).toContainEqual({
      level: 'warn',
      fields: { service: 'ikinci', source: 'grpc-js' },
      message: 'No address added out of total 1 resolved',
    });
    expect(stderr).not.toHaveBeenCalled();
  });
});

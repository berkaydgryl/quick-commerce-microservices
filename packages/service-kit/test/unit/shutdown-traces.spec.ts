/**
 * Kapanista izler (D15, ADR-20): bekleyen span'ler EN SON, kapanis kancasindan
 * SONRA gonderilir. Toplu gonderim 5 sn'de bir calisir; kapanis onu beklemez.
 *
 * Gercek OTLP/HTTP gonderici ve yerel toplayici. Surecte tek saglayici vardir
 * ve ilk startGrpcServer kurar; bu yuzden bu test AYRI dosyadadir (vitest her
 * dosyayi ayri surecte kosar): saglayici burada gonderim adresiyle kurulur.
 */

import { startOtlpCollector } from '@getir/observability/testing';
import type { OtlpCollector } from '@getir/observability/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createEchoImplementation, echoServiceDefinition } from '../../src/example/echo-service.js';
import { startTestGrpcServer } from '../../src/testing/index.js';
import { callByName } from './support/grpc-client.js';

const ECHO_SPAN_NAME = 'getir.example.v1.EchoService/Echo';

let collector: OtlpCollector | undefined;

afterEach(async () => {
  await collector?.close();
});

describe('zarif kapanis: izler (D15)', () => {
  it("bekleyen span'ler kancadan SONRA, toplu gonderim suresi beklenmeden gonderilir", async () => {
    collector = await startOtlpCollector();
    const sink = collector;
    let exportsAtHook: number | undefined;
    const server = await startTestGrpcServer({
      otlpEndpoint: sink.url,
      services: [
        { definition: echoServiceDefinition, implementation: createEchoImplementation('a') },
      ],
      onShutdown: () => {
        exportsAtHook = sink.captured().length;
      },
    });

    const result = await callByName(server.client, echoServiceDefinition, 'Echo', {
      message: 'kapanis',
      repeat: 1,
    });
    // Toplu gonderim 5 sn'de bir: cagridan hemen sonra hicbir sey gitmemis olmali.
    expect(result.error).toBeUndefined();
    expect(sink.captured()).toHaveLength(0);

    await server.stop('test');

    expect(exportsAtHook).toBe(0);
    expect(sink.captured().some((entry) => entry.body.includes(ECHO_SPAN_NAME))).toBe(true);
  });
});

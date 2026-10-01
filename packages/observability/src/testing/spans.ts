/**
 * Testte iz okuma (D15): surecin iz saglayicisini bellek ici disari gonderenle
 * kurar; test olusan span'leri adiyla, turuyle, ust span'iyle okur.
 *
 * Saglayici surecte TEK kez kurulur: bu yardimci startTracing'den (ornegin
 * startGrpcServer) ONCE cagrilmalidir; sonra kurulan sunucu ayni saglayiciyi
 * kullanir. Her test dosyasi ayri surecte kostugu icin dosyalar birbirini gormez.
 */

import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';

import { installProvider } from '../tracing/provider.js';
import { registeredProvider } from '../tracing/state.js';

export type { ReadableSpan } from '@opentelemetry/sdk-trace-node';

export interface RecordedSpans {
  /** Bitmis span'ler, bitis sirasiyla. */
  finished(): readonly ReadableSpan[];
  /** Kayitlari siler (testler arasi). */
  reset(): void;
}

let memory: InMemorySpanExporter | undefined;

/** Bellek ici saglayiciyi kurar (ikinci cagri ayni kaydi doner). */
export function recordSpans(): RecordedSpans {
  if (memory === undefined) {
    if (registeredProvider() !== undefined) {
      throw new Error('iz saglayicisi zaten kurulu: recordSpans testin basinda cagrilmali');
    }
    memory = new InMemorySpanExporter();
    // Esli islemci: span bittigi anda okunabilir (toplu islemci beklerdi).
    installProvider('test', [new SimpleSpanProcessor(memory)]);
  }
  const exporter = memory;
  return {
    finished: () => exporter.getFinishedSpans(),
    reset: () => {
      exporter.reset();
    },
  };
}

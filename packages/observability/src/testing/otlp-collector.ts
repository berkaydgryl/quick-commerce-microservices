/**
 * Yerel OTLP/HTTP toplayici (D15): disari gonderilen iz isteklerini yakalar,
 * testlerde Jaeger'in yerini tutar. Yalnizca 127.0.0.1, isletim sisteminin
 * sectigi port.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Toplayiciya gelen tek gonderim istegi. */
export interface CapturedExport {
  readonly path: string;
  readonly contentType: string | undefined;
  readonly body: string;
}

export interface OtlpCollector {
  /** Gonderim adresi (OTEL_EXPORTER_OTLP_ENDPOINT bicimi; gonderici /v1/traces ekler). */
  readonly url: string;
  /** Simdiye kadar gelen istekler (kopya). */
  captured(): CapturedExport[];
  /** true: istekler cevapsiz birakilir (asili toplayici). */
  hang(enabled: boolean): void;
  close(): Promise<void>;
}

export async function startOtlpCollector(): Promise<OtlpCollector> {
  const captured: CapturedExport[] = [];
  let hanging = false;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      captured.push({
        path: request.url ?? '',
        contentType: request.headers['content-type'],
        body,
      });
      if (!hanging) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    captured: () => [...captured],
    hang: (enabled) => {
      hanging = enabled;
    },
    close: () => {
      // Asili istekler acik kalir; kapatilmazsa close() hic donmezdi.
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

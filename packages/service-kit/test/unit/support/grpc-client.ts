/**
 * Testler icin kucuk bir gRPC istemcisi.
 *
 * NEDEN loadPackageDefinition'in urettigi hazir istemci KULLANILMIYOR: o nesne
 * `[methodName: string]: Function` index imzasi tasir; tip bilgisi `any`
 * uzerinden akar ve projenin tip bilgili eslint kurallari (no-unsafe-call,
 * no-unsafe-assignment) hakli olarak kirilir. Burada sozlesmeden gelen
 * serialize/deserialize fonksiyonlari dogrudan kullanilarak tipli bir cagri
 * yuzeyi kuruluyor.
 */

import { Metadata } from '@grpc/grpc-js';
import type {
  Client,
  ClientReadableStream,
  MethodDefinition,
  ServiceDefinition,
} from '@grpc/grpc-js';

/** Cagri sonucu: hata da deger de tipli olarak geri gelir. */
export interface UnaryResult<TResponse> {
  readonly error: Error | undefined;
  readonly response: TResponse | undefined;
}

function methodOf<TRequest, TResponse>(
  definition: ServiceDefinition,
  method: string,
): MethodDefinition<TRequest, TResponse> {
  const entry = definition[method] as MethodDefinition<TRequest, TResponse> | undefined;
  if (entry === undefined) {
    throw new Error(`Sozlesmede boyle bir RPC yok: ${method}`);
  }
  return entry;
}

/** Tek seferlik (unary) cagri. Hata firlatmaz; hatayi sonucta dondurur. */
export function unaryCall<TRequest, TResponse>(
  client: Client,
  definition: ServiceDefinition,
  method: string,
  request: TRequest,
  metadata: Metadata = new Metadata(),
): Promise<UnaryResult<TResponse>> {
  const entry = methodOf<TRequest, TResponse>(definition, method);
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      entry.path,
      entry.requestSerialize,
      entry.responseDeserialize,
      request,
      metadata,
      (error, response) => {
        resolve({ error: error ?? undefined, response: response ?? undefined });
      },
    );
  });
}

/** Sunucu akisi (server streaming) cagrisi. */
export function streamCall<TRequest, TResponse>(
  client: Client,
  definition: ServiceDefinition,
  method: string,
  request: TRequest,
): ClientReadableStream<TResponse> {
  const entry = methodOf<TRequest, TResponse>(definition, method);
  return client.makeServerStreamRequest(
    entry.path,
    entry.requestSerialize,
    entry.responseDeserialize,
    request,
  );
}

/** Akistan gelen ilk mesaji bekler. */
export function firstMessage<TResponse>(
  stream: ClientReadableStream<TResponse>,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    stream.once('data', resolve);
    stream.once('error', reject);
  });
}

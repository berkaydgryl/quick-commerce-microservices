/**
 * service-kit'in kendi testleri icin gRPC istemci yardimcilari.
 *
 * Buradaki servis tanimlari (health, ornek echo) ts-proto ile uretilmez,
 * proto dosyasindan yuklenir (loadServiceDefinition); bu yuzden metotlar ADLA
 * bulunur. Tipli unary cagrinin kendisi ortak yardimcidan gelir
 * (@getir/service-kit/testing, D5).
 */

import type {
  Client,
  ClientReadableStream,
  Metadata,
  MethodDefinition,
  ServiceDefinition,
} from '@grpc/grpc-js';

import { unaryCall } from '../../../src/testing/index.js';
import type { CallResult } from '../../../src/testing/index.js';

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

/** Adi verilen unary RPC'yi cagirir. Hata firlatmaz; hatayi sonucta dondurur. */
export function callByName<TRequest, TResponse>(
  client: Client,
  definition: ServiceDefinition,
  method: string,
  request: TRequest,
  metadata?: Metadata,
): Promise<CallResult<TResponse>> {
  return unaryCall(client, methodOf<TRequest, TResponse>(definition, method), request, metadata);
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

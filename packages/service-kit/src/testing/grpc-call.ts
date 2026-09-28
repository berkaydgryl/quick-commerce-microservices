/**
 * Testler icin tipli unary cagri (D5). Once sekiz ayri kopyasi vardi.
 *
 * NEDEN loadPackageDefinition'in hazir istemcisi DEGIL: o nesne
 * `[methodName: string]: Function` index imzasi tasir, tip bilgisi `any`
 * uzerinden akar ve tip bilgili eslint kurallari (no-unsafe-call) hakli olarak
 * kirilir. Burada sozlesmenin (ts-proto) serialize/deserialize fonksiyonlari
 * dogrudan kullanilir.
 */

import { Metadata } from '@grpc/grpc-js';
import type { Client, MethodDefinition, ServiceError } from '@grpc/grpc-js';

/** Cagri sonucu: hata FIRLATILMAZ, sonuca konur; testler kodu ve ayrintiyi okur. */
export interface CallResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

/** Bir sunucuya bagli tipli unary cagri. */
export type UnaryCall = <TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
  metadata?: Metadata,
) => Promise<CallResult<TResponse>>;

/** Metadata verilmezse bos gider (x-request-id'yi sunucu uretir). */
export function unaryCall<TRequest, TResponse>(
  client: Client,
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
  metadata: Metadata = new Metadata(),
): Promise<CallResult<TResponse>> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      metadata,
      (error, response) => {
        resolve({ error: error ?? undefined, response: response ?? undefined });
      },
    );
  });
}

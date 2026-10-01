/**
 * Sozlesmede tanimli ama HENUZ YAZILMAMIS (ya da kullanimdan kalkmis) RPC'nin
 * durus noktasi.
 *
 * NEDEN BOS BIRAKILMIYOR: grpc-js, uygulamasi verilmeyen metoda kendi cevabini
 * doner ("The server does not implement the method X"). O cevap x-app-error ve
 * x-request-id tasimaz; gateway onu INTERNAL/500 sanar, cagiran da nereye
 * bakacagini bilemez. Buradaki cevap diger hatalarla AYNI yoldan gider (D5):
 * kod NOT_IMPLEMENTED (gRPC UNIMPLEMENTED, HTTP 501), mesaj hangi gorevde
 * gelecegini ya da yerine neyin kullanilacagini soyler; requestId ve gunluk
 * satiri unaryHandler'in standart yolundan gelir.
 *
 * Her serviste ayni kopya duruyordu; burada tek yer.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { handleUnaryCall } from '@grpc/grpc-js';
import { z } from 'zod';

import type { Logger } from '../logger.js';
import { unaryHandler } from './handler.js';

/** Govde okunmaz: uc yok, dogrulanacak bir sey de yok. */
const anyRequestSchema = z.unknown();

/**
 * @param rpc    Metot adi ("GetProduct")
 * @param task   Hangi gorevde gelecegi ("T8.4") ya da yerine ne kullanilacagi;
 *               mesajda gorunur.
 * @param logger Verilirse cagri WARN olarak yazilir (NOT_IMPLEMENTED siradisi
 *               durumdur: cagiran eski ya da erken; @getir/core ERROR_CODE_SEVERITY).
 */
export function unimplemented(
  rpc: string,
  task: string,
  logger?: Logger,
): handleUnaryCall<unknown, never> {
  const message = `${rpc} henuz uygulanmadi (${task})`;
  return unaryHandler<unknown, never>({
    name: rpc,
    schema: anyRequestSchema,
    handle: (): never => {
      throw new AppError(ERROR_CODES.NOT_IMPLEMENTED, message);
    },
    ...(logger === undefined ? {} : { logger }),
  });
}

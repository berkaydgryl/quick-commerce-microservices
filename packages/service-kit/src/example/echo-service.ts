/**
 * Ornek gRPC servisi: getir.example.v1.EchoService.
 *
 * AMACI TEK: service-kit'in dort parcasinin (bootstrap, health, Zod dogrulama,
 * AppError cevirisi) gercekten birlikte calistigini disaridan - grpcurl ile -
 * gorulebilir kilmak. Urun kodunda kullanilmaz.
 *
 * Gercek bir servis bu dosyanin yerinde `src/interfaces/grpc/*.ts` tasir ve
 * sozlesmesini @getir/proto'dan (uretilen ts-proto tipleri) alir; buradaki tek
 * fark, sozlesmenin calisma zamaninda proto dosyasindan okunmasidir.
 */

import { fileURLToPath } from 'node:url';

import type { ServiceDefinition, UntypedServiceImplementation } from '@grpc/grpc-js';
import { z } from 'zod';

import { unaryHandler } from '../grpc/handler.js';
import { loadServiceDefinition } from '../grpc/proto.js';
import type { Logger } from '../logger.js';

/** Tam nitelikli servis adi; health tablosunda da bu adla gorunur. */
export const ECHO_SERVICE_NAME = 'getir.example.v1.EchoService';

const ECHO_PROTO_PATH = fileURLToPath(new URL('../../proto/echo.proto', import.meta.url));

export const echoServiceDefinition: ServiceDefinition = loadServiceDefinition(
  ECHO_PROTO_PATH,
  ECHO_SERVICE_NAME,
);

/** Mesajin en fazla uzunlugu; sinir proto'da degil, semada tanimlanir. */
const MAX_MESSAGE_LENGTH = 280;
const MIN_REPEAT = 1;
const MAX_REPEAT = 5;

/** Bilincli olarak INTERNAL uretmek icin gonderilen sihirli mesaj. */
export const BOOM_MESSAGE = 'bom';

export const echoRequestSchema = z.object({
  message: z.string().trim().min(1, 'bos olamaz').max(MAX_MESSAGE_LENGTH, 'cok uzun'),
  // proto3'te sayisal alanin varsayilani 0'dir ve "gonderilmedi" ile "0"
  // ayirt edilemez; bu yuzden 0 burada "varsayilani kullan" anlamina gelir.
  repeat: z
    .number()
    .int()
    .min(0)
    .max(MAX_REPEAT, `en fazla ${MAX_REPEAT}`)
    .transform((value) => (value === 0 ? MIN_REPEAT : value)),
});

export type EchoRequest = z.infer<typeof echoRequestSchema>;

export interface EchoResponse {
  message: string;
  servedBy: string;
}

/** Ornek servisin uygulamasi. */
export function createEchoImplementation(
  servedBy: string,
  logger?: Logger,
): UntypedServiceImplementation {
  return {
    Echo: unaryHandler({
      name: 'Echo',
      schema: echoRequestSchema,
      handle: ({ message, repeat }): EchoResponse => {
        if (message === BOOM_MESSAGE) {
          // Bilerek AppError DEGIL: ara katmanin beklenmeyen hatayi da
          // INTERNAL'a cevirdigini ve mesaji disari SIZDIRMADIGINI gosterir.
          throw new Error('ornek patlama: bu mesaj istemciye gitmemeli');
        }
        return { message: Array.from({ length: repeat }, () => message).join(' '), servedBy };
      },
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}

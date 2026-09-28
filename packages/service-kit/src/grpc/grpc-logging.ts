/**
 * grpc-js'in KENDI gunluk satirlari (D5; D2'de bulundu).
 *
 * grpc-js varsayilan olarak stderr'e duz metin yazar (port doluyken
 * "E No address added out of total 1 resolved" gibi): servisin JSON gunlugunun
 * yaninda ayristirilamayan satirlar. Burada grpc-js'in gunlukcusu servisin
 * gunlukcusune baglanir; satir `source: 'grpc-js'` alaniyla JSON olarak yazilir.
 *
 * SEVIYE: grpc-js'in ERROR'u bizde WARN'dir. Kutuphane teshisidir; sonucun
 * kendisini (acilamayan port, dusen cagri) servis kodu kendi seviyesiyle yazar.
 * Hangi satirlarin gelecegini grpc-js'in GRPC_VERBOSITY / GRPC_TRACE ortam
 * degiskenleri belirler (varsayilan: yalnizca ERROR).
 *
 * grpc-js'in gunlukcusu PROCESS GENELIDIR, son baglanan gecerlidir. Servis
 * basina tek sunucu oldugu icin startGrpcServer her acilista baglar.
 */

import { format } from 'node:util';

import { setLogger } from '@grpc/grpc-js';

import type { Logger } from '../logger.js';

const SOURCE = { source: 'grpc-js' } as const;

/** grpc-js'in error/info/debug satirlarini verilen gunlukcuye yonlendirir. */
export function routeGrpcJsLogs(logger: Logger): void {
  const text = (message: unknown, params: readonly unknown[]): string => format(message, ...params);
  setLogger({
    error: (message?: unknown, ...params: unknown[]): void => {
      logger.warn(SOURCE, text(message, params));
    },
    info: (message?: unknown, ...params: unknown[]): void => {
      logger.info(SOURCE, text(message, params));
    },
    debug: (message?: unknown, ...params: unknown[]): void => {
      logger.debug(SOURCE, text(message, params));
    },
  });
}

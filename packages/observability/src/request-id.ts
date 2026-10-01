/**
 * Korelasyon kimligi (request-id; T10.5'te service-kit'ten tasindi).
 *
 * Bir istegin butun servislerdeki gunluk satirlarini ve hata cevabini birbirine
 * baglar. Gateway istegi karsilarken uretir (bicim D8: `req_` + 32 onaltilik),
 * her gRPC cagrisina metadata olarak koyar; servisler arasi cagrida ayni deger
 * GECIRILIR, yenisi uretilmez.
 *
 * Burada TASIMA YOKTUR: anahtarin gRPC metadata'sindan okunmasi service-kit'in
 * (`grpc/context.ts`), HTTP basligindan okunmasi gateway'in isidir. Bu dosya
 * yalnizca anahtari ve "gelen degeri kullan, yoksa uret" kuralini tasir.
 */

import { ID_PREFIX, newId } from '@getir/core';

/**
 * Korelasyon kimliginin tasindigi anahtar: gRPC metadata'si ve HTTP basligi.
 * SOZLESMEDIR: gateway (Go) da okur. gRPC metadata anahtarlari KUCUK HARF
 * olmak zorundadir.
 */
export const REQUEST_ID_METADATA_KEY = 'x-request-id';

/**
 * Gelen kimligi (bas/son bosluksuz) kullanir; yoksa ya da bossa yenisini uretir.
 *
 * Uretmek onemli: gateway'i atlayarak (grpcurl, baska bir servis, test) gelen
 * cagrinin da gunlukte tek bir ize baglanmasi gerekir.
 */
export function resolveRequestId(incoming: unknown): string {
  if (typeof incoming === 'string' && incoming.trim() !== '') {
    return incoming.trim();
  }
  return newId(ID_PREFIX.REQUEST);
}

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

import { ID_PREFIX, isId, newId } from '@getir/core';

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

/**
 * DIS KAPI kurali (D8, gateway ile ayni; #22): gelen kimlik YALNIZCA bicime
 * uyarsa (`req_` + 32 kucuk onaltilik) kabul edilir, aksi halde yenisi uretilir.
 *
 * resolveRequestId'den farki: o, ic cagrilar icindir (gRPC metadata'si; tek dis
 * kapi gateway zaten bicimli kimlik gonderir). Disariya acik bir sunucu
 * (realtime) istemcinin elindeki degeri bu fonksiyondan gecirir: serbest metin
 * kabul edilseydi birkac KB'lik bir deger her gunluk satirina girer ve kimlik
 * tek desenle aranamazdi. Bosluk da kirpilmaz; gateway gibi birebir eslesme.
 */
export function acceptRequestId(incoming: unknown): string {
  return isId(ID_PREFIX.REQUEST, incoming) ? incoming : newId(ID_PREFIX.REQUEST);
}

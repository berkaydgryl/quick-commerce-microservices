/**
 * .proto dosyasindan calisma zamaninda servis tanimi yukleme.
 *
 * NE ZAMAN BU, NE ZAMAN @getir/proto:
 * Urun servisleri sozlesmelerini DERLEME ZAMANINDA uretir (ts-proto, T2.3) ve
 * tipli tanimi dogrudan import eder - hizli, tipli, uretilen kod tek kaynaktan.
 * Bu yardimci yalnizca service-kit'in kendi tasidigi iki dosya icindir:
 * standart `grpc.health.v1` ve ornek sunucunun `getir.example.v1` sozlesmesi.
 * Ikisi de packages/proto'ya AIT DEGILDIR (biri ekosistemin, digeri yalnizca
 * demo icin), bu yuzden uretim hattina sokulmak yerine burada okunur.
 */

import { loadPackageDefinition } from '@grpc/grpc-js';
import type { ServiceDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { Options } from '@grpc/proto-loader';

/**
 * Yukleyici secenekleri, ts-proto ciktisiyla AYNI sekli uretecek bicimde
 * secildi; boylece iki yoldan gelen mesajlar kod icinde ayni gorunur:
 *  - keepCase: false -> served_by alani servedBy olur (ts-proto snakeToCamel).
 *  - longs: String   -> int64 hassasiyeti Number'a dusurulmez (para kurustur).
 *  - enums: String   -> gunlukte ve grpcurl ciktisinda 1 yerine "SERVING".
 *  - defaults: true  -> eksik alanlar proto3 varsayilaniyla dolar, undefined kalmaz.
 */
const LOADER_OPTIONS: Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

/**
 * Verilen .proto dosyasindan tek bir servisin tanimini cikarir.
 *
 * @param protoPath Mutlak dosya yolu.
 * @param serviceName Tam nitelikli servis adi (orn. "grpc.health.v1.Health").
 */
export function loadServiceDefinition(protoPath: string, serviceName: string): ServiceDefinition {
  const packageDefinition = loadSync(protoPath, LOADER_OPTIONS);
  let node: unknown = loadPackageDefinition(packageDefinition);

  for (const segment of serviceName.split('.')) {
    if (typeof node !== 'object' || node === null) {
      throw new Error(`Proto icinde bulunamadi: ${serviceName} (${protoPath})`);
    }
    node = (node as Record<string, unknown>)[segment];
  }

  // loadPackageDefinition bir servis icin "istemci kurucusu" dondurur; sunucu
  // tarafinin ihtiyaci olan tanim onun statik `service` alanindadir.
  const definition = (node as { service?: ServiceDefinition } | undefined)?.service;
  if (definition === undefined) {
    throw new Error(`Servis tanimi yok: ${serviceName} (${protoPath})`);
  }
  return definition;
}

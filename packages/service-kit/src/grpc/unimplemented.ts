/**
 * Sozlesmede tanimli ama HENUZ YAZILMAMIS RPC'nin durus noktasi.
 *
 * NEDEN BOS BIRAKILMIYOR: grpc-js, tanimda olup uygulamada olmayan her metot
 * icin acilista hata seviyesinde gunluk yazar - her acilista "bir sey bozuk"
 * izlenimi verir. NEDEN AppError DEGIL: "bu uc henuz yok" bir is hatasi degil,
 * protokol gercegidir; karsiligi dogrudan UNIMPLEMENTED.
 *
 * Her serviste ayni kopya duruyordu; burada tek yer.
 */

import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import type { handleUnaryCall } from '@grpc/grpc-js';

/**
 * @param rpc  Metot adi ("GetProduct")
 * @param task Hangi gorevde gelecegi ("T4.5"); mesajda gorunur.
 */
export function unimplemented(rpc: string, task: string): handleUnaryCall<unknown, never> {
  return (_call, callback) => {
    const message = `${rpc} henuz uygulanmadi (${task})`;
    callback({
      name: 'ServiceError',
      message,
      code: GrpcStatus.UNIMPLEMENTED,
      details: message,
      metadata: new Metadata(),
    });
  };
}

/**
 * Sure siniri testleri icin bekletilen cevaplar (#113: E3 risk, E5 catalog). Sahte sunucu yavas
 * istegin cevabini VERMEZ; istegin kimligini (x-request-id) ve ISTEMCININ gonderdigi sure
 * sinirindan kalan sureyi kaydeder. Boylece test iki seyi birlikte kanitlar:
 *   - istek sunucuya ULASTI (kesilen, kanal kurulumu degil bekleyen cevaptir);
 *   - istemci KENDI kisa sinirini gonderdi (sinirini yok sayip daha uzun bekleyen istemci duser).
 * Bekletilen cagrilari istemcinin iptali ve sunucunun grpc-timeout'u kapatir; elle cevap gerekmez.
 */

import { REQUEST_ID_METADATA_KEY } from '@getir/service-kit';
import type { ServerUnaryCall } from '@grpc/grpc-js';

/**
 * order gRPC istemci testlerinin ortak sureleri (#113). Islevsel istemci: ilk cagri kanal kurulumunu
 * da oder, soguk 200-500 ms'lik istemci yuklu makinede asiliyordu; 2 sn hem bol hem de arka arkaya
 * birkac cagri testTimeout'un (10 sn) altinda kalir ve yeniden denemenin geri cekilmesini sinirlar.
 */
export const FUNCTIONAL_TIMEOUT_MS = 2_000;
/** Yalnizca sure siniri testlerinin kisa siniri; yavas istegin cevabi HIC gelmez. */
export const DEADLINE_TIMEOUT_MS = 200;
/** Sure testinin zaman butcesi: istek sunucuya ulasana kadar tekrar (testTimeout'un altinda). */
export const REACH_BUDGET_MS = 5_000;

export interface HeldReply {
  /** Istegin x-request-id'si: denemeyi kesin olarak tanir. */
  readonly requestId: string;
  /** Sunucuya ulastiginda istemcinin sure sinirindan kalan sure (ms). */
  readonly remainingMs: number;
}

export class HeldReplies {
  private readonly entries: HeldReply[] = [];

  /** Cevabi vermeden istegi kaydeder. */
  hold(call: ServerUnaryCall<unknown, unknown>): void {
    const deadline = call.getDeadline();
    const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline;
    this.entries.push({
      requestId: String(call.metadata.get(REQUEST_ID_METADATA_KEY)[0] ?? ''),
      remainingMs: deadlineMs - Date.now(),
    });
  }

  of(requestId: string): HeldReply | undefined {
    return this.entries.find((entry) => entry.requestId === requestId);
  }
}

let cutRound = 0;

/**
 * Yavas cagriyi, istegi sunucuya ULASANA kadar (zaman butcesi icinde) tekrarlar. Yuklu makinede
 * ilk deneme kanal kurulumunda kesilebilir; her deneme kendi istek kimligiyle taninir.
 */
export async function cutAfterReach(
  attempt: (requestId: string) => Promise<unknown>,
  held: HeldReplies,
  budgetMs: number,
): Promise<{ readonly error: unknown; readonly reply: HeldReply }> {
  // Cagri basina benzersiz on ek: onceki kosunun (--retry, ikinci cagri) kaydiyla eslesmesin.
  cutRound += 1;
  const until = Date.now() + budgetMs;
  for (let index = 1; ; index += 1) {
    const requestId = `req_sure_siniri_${cutRound}_${index}`;
    const error = await attempt(requestId).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    if (error === undefined) throw new Error('yavas cagri cevap aldi: sure siniri kesmedi');
    const reply = held.of(requestId);
    if (reply !== undefined) return { error, reply };
    if (Date.now() > until) throw new Error('yavas istek sunucuya hic ulasmadi');
  }
}

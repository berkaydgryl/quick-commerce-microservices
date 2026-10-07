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

/**
 * Yavas cagriyi, istegi sunucuya ULASANA kadar (zaman butcesi icinde) tekrarlar. Yuklu makinede
 * ilk deneme kanal kurulumunda kesilebilir; her deneme kendi istek kimligiyle taninir.
 */
export async function cutAfterReach(
  attempt: (requestId: string) => Promise<unknown>,
  held: HeldReplies,
  budgetMs: number,
): Promise<{ readonly error: unknown; readonly reply: HeldReply }> {
  const until = Date.now() + budgetMs;
  for (let index = 1; ; index += 1) {
    const requestId = `req_sure_siniri_${index}`;
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

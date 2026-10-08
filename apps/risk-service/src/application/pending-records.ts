/**
 * Ucustaki risk_events kayitlari (#167). Her kayit YAZIM BASLARKEN izlenir (sure
 * sinirini asmasi beklenmez): kapanis, karar donmus ama yazimi suren kaydi da,
 * siniri henuz dolmamis kaydi da gorur.
 *
 *   - Kayit biterse `onDone`, duserse `onLost`: BIR KEZ, hangisi once.
 *   - Kapanista (drain) sinirli sure beklenir; bosaltma SURERKEN gelen kayit da
 *     beklenir (Mongo hala acik). Sure dolunca bitmeyenler "yarim kaldi" diye
 *     birakilir (`onLost`), sonra gelen sonuc yok sayilir.
 *   - Bosaltma BITTIKTEN sonra izlemeye giren kayit hemen birakilmis sayilir
 *     (Mongo kapaniyor).
 *
 * Bildirimler firlatsa da (metrik, gunluk) soz zinciri reddedilmez: izleme
 * unhandledRejection URETMEZ (installProcessHandlers bunu olumcul sayar).
 *
 * KABUL: kapanista birakilan kayit sunucuda yine de uygulanmis olabilir
 * (yanit gelmeden baglanti kapandi); kayip sayilir.
 */

import { TimeoutError, withTimeout } from './with-timeout.js';

export interface RecordWatch {
  /** Kayit yazildi. */
  readonly onDone: () => void;
  /** Kayit dustu ya da kapanista yarim kaldi. */
  readonly onLost: (reason: unknown) => void;
}

/** Kapanistan sonra ya da bosaltma suresince bitmeyen kaydin gerekcesi. */
export const ABANDONED_REASON = 'kapanista kayit yarim kaldi';

export class PendingRecords {
  /** Kayit -> kapanista yarim kalirsa cagrilacak birakma. */
  private readonly pending = new Map<Promise<unknown>, () => void>();
  private closed = false;

  /** Bekleyen kayit sayisi. */
  get size(): number {
    return this.pending.size;
  }

  watch(record: Promise<unknown>, handlers: RecordWatch): void {
    let settled = false;
    const settle = (notify: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      this.pending.delete(record);
      quietly(notify);
    };
    const abandon = (): void => settle(() => handlers.onLost(new Error(ABANDONED_REASON)));
    record.then(
      () => settle(handlers.onDone),
      (reason: unknown) => settle(() => handlers.onLost(reason)),
    );
    if (this.closed) {
      abandon();
      return;
    }
    this.pending.set(record, abandon);
  }

  /**
   * Bekleyenleri (bosaltma surerken gelenler dahil) en fazla `timeoutMs`
   * bekler; sonra izlemeyi kapatir ve bitmeyenleri birakir.
   * @returns Birakilan kayit sayisi.
   */
  async drain(timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0 && Date.now() < deadline) {
      const waiting = withTimeout(
        Promise.allSettled([...this.pending.keys()]),
        deadline - Date.now(),
        'risk kayitlarinin bosaltilmasi',
      );
      await waiting.catch((error: unknown) => {
        if (!(error instanceof TimeoutError)) {
          throw error;
        }
      });
    }
    this.closed = true;
    const abandoned = [...this.pending.values()];
    for (const abandon of abandoned) {
      abandon();
    }
    return abandoned.length;
  }
}

/**
 * Bildirimi calistirir; firlatirsa yutar. Bildirim metrik ya da gunluktur:
 * hatasi kaydi, karari ya da sureci dusurmemeli.
 */
function quietly(notify: () => void): void {
  try {
    notify();
  } catch {
    // Bildirim kanalinin kendisi bozuk: yazilacak baska yer yok.
  }
}

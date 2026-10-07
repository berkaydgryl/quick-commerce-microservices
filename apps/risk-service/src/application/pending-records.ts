/**
 * Arka planda suren risk_events kayitlari (#167). Sure sinirini asan kayit
 * beklenmeden karar doner; kayit surer ve burada izlenir:
 *
 *   - Kayit sonradan biterse `onLate`, duserse `onLost`: BIR KEZ, hangisi once.
 *   - Kapanista (drain) sinirli sure beklenir; bitmeyen "yarim kaldi" diye
 *     birakilir (`onLost`), sonra gelen sonuc yok sayilir. Kapanistan SONRA
 *     izlemeye giren kayit hemen birakilmis sayilir (Mongo kapaniyor).
 *
 * Bildirimler firlatsa da (metrik, gunluk) soz zinciri reddedilmez: izleme
 * unhandledRejection URETMEZ (installProcessHandlers bunu olumcul sayar).
 *
 * KABUL: kapanista birakilan kayit sunucuda yine de uygulanmis olabilir
 * (yanit gelmeden baglanti kapandi); kayip sayilir.
 */

import { TimeoutError, withTimeout } from './with-timeout.js';

export interface RecordWatch {
  /** Kayit sinirdan sonra yazildi. */
  readonly onLate: () => void;
  /** Kayit dustu ya da kapanista yarim kaldi. */
  readonly onLost: (reason: unknown) => void;
}

/** Kapanistan sonra ya da drain suresince bitmeyen kaydin gerekcesi. */
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
      () => settle(handlers.onLate),
      (reason: unknown) => settle(() => handlers.onLost(reason)),
    );
    if (this.closed) {
      abandon();
      return;
    }
    this.pending.set(record, abandon);
  }

  /**
   * Izlemeyi kapatir; bekleyenleri en fazla `timeoutMs` bekler, bitmeyenleri
   * birakir. @returns Birakilan kayit sayisi.
   */
  async drain(timeoutMs: number): Promise<number> {
    this.closed = true;
    if (this.pending.size > 0) {
      await withTimeout(
        Promise.allSettled([...this.pending.keys()]),
        timeoutMs,
        'risk kayitlarinin bosaltilmasi',
      ).catch((error: unknown) => {
        if (!(error instanceof TimeoutError)) {
          throw error;
        }
      });
    }
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

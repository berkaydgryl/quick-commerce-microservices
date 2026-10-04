/**
 * Atanamayan siparisin geri cekilmesi (D3, T13.2): courier ya da depo bir
 * siparise hata verdikce o siparis her turda yeniden denenmez. Bekleme 1 sn'den
 * baslar, her hatada ikiye katlanir, en cok 5 dk; basari kaydi siler.
 *
 * Durum BELLEKTE ve ornek basinadir: servis yeniden baslayinca sifirlanir
 * (siparis bir kez daha hemen denenir; zararsiz). Kuyruktan cikan siparisin
 * kaydi, en uzun beklemeden sonra da dokunulmadiysa silinir: bellek sinirli.
 */

export interface FailureBackoffOptions {
  /** Ilk hatadan sonraki bekleme (ms). */
  readonly initialMs: number;
  /** Beklemenin ust siniri (ms). */
  readonly maxMs: number;
}

/** Hatanin sonucu: siradaki deneme ani ve ilk hata mi (gunluge bir kez yazilir). */
export interface BackoffStep {
  readonly first: boolean;
  readonly failures: number;
  readonly retryAt: Date;
}

interface Entry {
  readonly failures: number;
  readonly retryAtMs: number;
}

export class FailureBackoff {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: FailureBackoffOptions) {}

  /** Siparis `now` itibariyla hala geri cekilmede mi? */
  isWaiting(orderId: string, now: Date): boolean {
    const entry = this.entries.get(orderId);
    return entry !== undefined && entry.retryAtMs > now.getTime();
  }

  /** Siparis yine hata verdi: bekleme uzar (1 sn, 2 sn, 4 sn ... en cok 5 dk). */
  failed(orderId: string, now: Date): BackoffStep {
    const failures = (this.entries.get(orderId)?.failures ?? 0) + 1;
    const delayMs = Math.min(this.options.initialMs * 2 ** (failures - 1), this.options.maxMs);
    const retryAtMs = now.getTime() + delayMs;
    this.entries.set(orderId, { failures, retryAtMs });
    return { first: failures === 1, failures, retryAt: new Date(retryAtMs) };
  }

  /** Siparis hatasiz islendi: kaydi silinir. */
  succeeded(orderId: string): void {
    this.entries.delete(orderId);
  }

  /** Deneme ani en uzun beklemeden de eskiyse kayit artik izlenmiyor demektir: silinir. */
  prune(now: Date): void {
    const staleBefore = now.getTime() - this.options.maxMs;
    for (const [orderId, entry] of this.entries) {
      if (entry.retryAtMs < staleBefore) {
        this.entries.delete(orderId);
      }
    }
  }

  /** Izlenen siparis sayisi (test ve gozlem). */
  get size(): number {
    return this.entries.size;
  }
}

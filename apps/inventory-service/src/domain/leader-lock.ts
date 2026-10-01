/**
 * Supurucu liderligi (T10.3; roadmap B25, ADR-01: dagitik kilit yalnizca
 * burada). Ayni anda yalnizca bir servis ornegi supurur; lider her turda
 * kilidini yeniler, dusurse kilit en gec omru dolunca baska ornege gecer.
 *
 * Liderlik bir GUVENLIK sarti degil, verim sartidir: iki ornek ayni anda
 * supurse de rezervasyon tek yoldan sonuclanir (ZREM sahipligi, B3).
 */
export interface LeaderLock {
  /** Kilidi alir ya da (zaten bizdeyse) yeniler. true: bu ornek lider. */
  hold(): Promise<boolean>;
  /** Kilit bizdeyse birakir (kapanista); baskasindaysa dokunmaz. */
  release(): Promise<void>;
}

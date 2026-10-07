/**
 * Tick liderligi (T13.3; ADR-01, karar M5 a): ayni anda yalnizca bir servis
 * ornegi rotalari ilerletir; lider her turda kilidini yeniler, duserse kilit
 * en gec omru dolunca baska ornege gecer.
 *
 * Liderlik bir GUVENLIK sarti degil, verim sartidir: iki ornek ayni turu
 * isletse de kilometre taslari kosullu yazilir (rota durumu ve kimligi), olay
 * tekrari tuketicide zararsizdir. inventory supurucusunun liderligiyle ayni
 * sozlesme (servisler kod paylasmaz).
 */
export interface LeaderLock {
  /** Kilidi alir ya da (zaten bizdeyse) yeniler. true: bu ornek lider. */
  hold(): Promise<boolean>;
  /** Kilit bizdeyse birakir (kapanista); baskasindaysa dokunmaz. */
  release(): Promise<void>;
}

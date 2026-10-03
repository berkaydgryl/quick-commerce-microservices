/**
 * Siparis odasindaki sira kurali (T12.3, K4): `seq` siparisin surumudur.
 *
 * Olay hatti ayni siparisin olaylarini sirasiz teslim edebilir (yeniden teslim,
 * ayni grupta birden cok kopya). Daha eski surum odaya YAYINLANMAZ: istemci zaten
 * atardi, ama bos yere trafik ve yanlis "geri gitti" izlenimi olusurdu.
 *
 * Esit surum yeniden yayinlanir (D2): ayni olay ikinci kez geldiyse ilk teslimde
 * yayindan once cokulmus olabilir. Teslim en az bir kezdir; istemci seq <= gordugu
 * degeri atar, tekrar zararsizdir.
 */

export const SEQ_DECISION = {
  /** Bu siparis icin gorulmus en buyuk surum: yayinla. */
  NEWER: 'newer',
  /** Ayni surum yeniden geldi: yeniden yayinla (en az bir kez). */
  SAME: 'same',
  /** Daha yeni bir surum zaten yayinlandi: atla. */
  STALE: 'stale',
} as const;

export type SeqDecision = (typeof SEQ_DECISION)[keyof typeof SEQ_DECISION];

/** `previous`: daha once kaydedilen en buyuk surum; hic yoksa undefined. */
export function decideSeq(previous: number | undefined, seq: number): SeqDecision {
  if (previous === undefined || seq > previous) {
    return SEQ_DECISION.NEWER;
  }
  return seq === previous ? SEQ_DECISION.SAME : SEQ_DECISION.STALE;
}

import type { ReserveCartRequest } from '@getir/contracts';

/**
 * Kart 404'unden sonra TUTULAN siparis (T12.4; PM karari K2): rezervasyon ve
 * siparis kimligi korunur; kullanici baska kart secince ayni siparis yeniden
 * verilir (rezervasyon TEKRARLANMAZ). Gecerlilik: rezervasyon istegi ayni
 * (sepet, adres, tutar) ve rezervasyonun suresi dolmamis.
 */
export interface HeldOrder {
  readonly orderId: string;
  /** Rezervasyon isteginin parmak izi (heldFingerprint). */
  readonly fingerprint: string;
  /** Rezervasyon cevabinin alindigi an (deps.now) ve sunucunun kalan saniyesi. */
  readonly reservationReceivedAt: number;
  readonly reservationTtlSeconds: number | undefined;
}

const MS_PER_SECOND = 1000;

/** Rezervasyon isteginin parmak izi: kalemler, adres ve beklenen tutar. */
export function heldFingerprint(request: ReserveCartRequest): string {
  return JSON.stringify(request);
}

/**
 * Tutulan siparis bu istekle simdi yeniden verilebilir mi: istek ayni ve
 * sure dolmamis (sunucu sure bildirmediyse sure kurali yok; dolmussa siparis
 * ucu reddeder ve akis bastan baslar).
 */
export function canReuseHeldOrder(
  held: HeldOrder,
  request: ReserveCartRequest,
  now: number,
): boolean {
  const expiresAt =
    held.reservationTtlSeconds === undefined
      ? undefined
      : held.reservationReceivedAt + held.reservationTtlSeconds * MS_PER_SECOND;
  return (
    held.fingerprint === heldFingerprint(request) && (expiresAt === undefined || now < expiresAt)
  );
}

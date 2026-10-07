import type { CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';

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
  /**
   * Siparis bir kez verildiyse (kart 404'u) ayrintilarin ve odeme yonteminin
   * parmak izi (orderBodyFingerprint): sunucu bekleyen sipariste bunlarin
   * degisimini yok sayar ya da reddeder (QA #176 N2); degistiyse siparis
   * yeniden kullanilmaz, rezervasyon birakilip yeniden alinir.
   */
  readonly placedWith?: string | undefined;
}

/** Siparisin kartTAN bagimsiz kismi: odeme yontemi ve ayrintilar (hediye, not, zil, sozlesme). */
export function orderBodyFingerprint(body: CreateOrderRequest): string {
  return JSON.stringify({ method: body.payment.method, details: body.details });
}

/**
 * Tutulan siparis bu govdeyle yeniden verilebilir mi (QA #176 N2): siparis hic
 * verilmediyse (yalniz rezervasyon) evet; verildiyse yontem ve ayrintilar ayni
 * olmali (yalniz kart degisebilir). Degilse ayni orderId KULLANILMAZ.
 */
export function heldMatchesBody(held: HeldOrder, body: CreateOrderRequest): boolean {
  return held.placedWith === undefined || held.placedWith === orderBodyFingerprint(body);
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
  const expiresAt = heldExpiresAt(held);
  return (
    held.fingerprint === heldFingerprint(request) && (expiresAt === undefined || now < expiresAt)
  );
}

/** Rezervasyonun son ani (deps.now saatinde); sunucu sure bildirmediyse undefined. */
export function heldExpiresAt(held: HeldOrder): number | undefined {
  return held.reservationTtlSeconds === undefined
    ? undefined
    : held.reservationReceivedAt + held.reservationTtlSeconds * MS_PER_SECOND;
}

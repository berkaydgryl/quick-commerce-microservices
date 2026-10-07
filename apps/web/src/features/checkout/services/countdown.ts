/**
 * 3DS geri sayimi (T12.4; T17.1 olcutu: son 30 saniyede uyari). SAF: saat
 * disaridan verilir (monotonik, ms; tarayicida performance.now). Kalan sure
 * istemcinin duvar saatinden DEGIL, sunucunun bildirdigi sureden kurulur
 * (T11.4 kurali): rezervasyonun ttlSeconds'i, alindigi andan sayilir.
 */

/**
 * Kodun gecerlilik suresi: payment-service THREEDS_CHALLENGE_TTL_MS (60 sn).
 * Yanit (orderPlacement.threeDs) sureyi tasimiyor; sunucu eklerse buradan
 * kalkar (DURDU'da backend'e onerildi).
 */
export const THREEDS_CHALLENGE_SECONDS = 60;

/** Bu kadar saniye ve altinda uyari durumu. */
export const COUNTDOWN_WARNING_SECONDS = 30;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export interface DeadlineInput {
  /** Rezervasyon yanitinin alindigi an ve sunucunun kalan saniyesi (yoksa yalniz kod suresi). */
  readonly reservationReceivedAt: number;
  readonly reservationTtlSeconds: number | undefined;
  /** 3DS isteyen siparis yanitinin alindigi an. */
  readonly challengeReceivedAt: number;
}

/** Son an: kodun suresi ile rezervasyonun kalan suresinden KISA olani. */
export function challengeDeadline({
  reservationReceivedAt,
  reservationTtlSeconds,
  challengeReceivedAt,
}: DeadlineInput): number {
  const challengeEnd = challengeReceivedAt + THREEDS_CHALLENGE_SECONDS * MS_PER_SECOND;
  return reservationTtlSeconds === undefined
    ? challengeEnd
    : Math.min(challengeEnd, reservationReceivedAt + reservationTtlSeconds * MS_PER_SECOND);
}

/** Kalan tam saniye (yukari yuvarlanir; sifirin alti yok). */
export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / MS_PER_SECOND));
}

/** Son 30 saniye (0 dahil degil: sure doldu durumu ayridir). */
export function isCountdownWarning(seconds: number): boolean {
  return seconds > 0 && seconds <= COUNTDOWN_WARNING_SECONDS;
}

/** "1:00", "0:29". */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

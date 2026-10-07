/**
 * 3DS geri sayimi (T12.4; T17.1 olcutu: son 30 saniyede uyari). SAF: saat
 * disaridan verilir (monotonik, ms; tarayicida performance.now). Kalan sure
 * istemcinin duvar saatinden DEGIL, sunucunun bildirdigi surelerden kurulur
 * (T11.4 kurali): rezervasyonun ve kodun ttlSeconds'i, alindiklari andan sayilir.
 */

/** Bu kadar saniye ve altinda uyari durumu. */
export const COUNTDOWN_WARNING_SECONDS = 30;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export interface DeadlineInput {
  /** Rezervasyon yanitinin alindigi an ve sunucunun kalan saniyesi (yoksa undefined). */
  readonly reservationReceivedAt: number;
  readonly reservationTtlSeconds: number | undefined;
  /** 3DS isteyen siparis yanitinin alindigi an ve kodun kalan saniyesi (threeDs.ttlSeconds). */
  readonly challengeReceivedAt: number;
  readonly challengeTtlSeconds: number | undefined;
}

/**
 * Son an: kodun suresi ile rezervasyonun kalan suresinden KISA olani; ikisi
 * de sunucudan gelir (istemci sure TAHMIN ETMEZ; PM karari K1). Biri yoksa
 * digeri; ikisi de yoksa undefined: geri sayim gosterilmez, sureyi sunucu
 * uygular (suresi gecen kod reddedilir).
 */
export function challengeDeadline({
  reservationReceivedAt,
  reservationTtlSeconds,
  challengeReceivedAt,
  challengeTtlSeconds,
}: DeadlineInput): number | undefined {
  const ends = [
    reservationTtlSeconds === undefined
      ? undefined
      : reservationReceivedAt + reservationTtlSeconds * MS_PER_SECOND,
    challengeTtlSeconds === undefined
      ? undefined
      : challengeReceivedAt + challengeTtlSeconds * MS_PER_SECOND,
  ].filter((end): end is number => end !== undefined);
  return ends.length === 0 ? undefined : Math.min(...ends);
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

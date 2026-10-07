/**
 * 3DS geri sayimi (T12.4; T17.1 olcutu: son 30 saniyede uyari). SAF: saat
 * disaridan verilir (monotonik, ms; tarayicida performance.now). Kalan sure
 * istemcinin duvar saatinden DEGIL, sunucunun bildirdigi surelerden kurulur
 * (T11.4 kurali): rezervasyonun ve kodun ttlSeconds'i, alindiklari andan sayilir.
 */

/** 3DS: bu kadar saniye ve altinda uyari durumu. */
export const COUNTDOWN_WARNING_SECONDS = 30;

/** Rezervasyonun kalan suresi: son 60 saniyede uyari (erken rezervasyon). */
export const RESERVATION_WARNING_SECONDS = 60;

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

/** 3DS'in son 30 saniyesi (0 dahil degil: sure doldu durumu ayridir). */
export function isCountdownWarning(seconds: number): boolean {
  return seconds > 0 && seconds <= COUNTDOWN_WARNING_SECONDS;
}

/** Rezervasyonun son 60 saniyesi (0 dahil degil: sure doldu, yeniden ayrilir). */
export function isReservationWarning(seconds: number): boolean {
  return seconds > 0 && seconds <= RESERVATION_WARNING_SECONDS;
}

/** "1:00", "0:29". */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

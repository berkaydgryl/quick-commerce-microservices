/**
 * Rezervasyonu sonuclandiran use-case'lerin (Release, Commit; T10.2) ortak
 * sonucu: inventory.proto ReservationOutcome'un uygulama karsiligi. Hata degil
 * SONUC: cagiran (order saga'si) sonuca gore dallanir (B3, B4).
 */

export type ReservationResultOutcome = 'applied' | 'already-applied' | 'not-found';

export interface ReservationResult {
  readonly outcome: ReservationResultOutcome;
}

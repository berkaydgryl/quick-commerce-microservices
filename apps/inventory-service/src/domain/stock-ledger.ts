/**
 * Stok defteri (T10.2; roadmap veri modeli `stock_ledger`, ADR-18): her stok
 * hareketinin degismez kaydi. "Stok nereye gitti" sorusunun cevabi burada.
 *
 * Defter ELDEKI ADEDIN (onHand) hesabidir: bir market x SKU icin delta'larin
 * toplami onHand'e esittir (T10.2 bitti tanimi).
 *   - opening: seed'in acilis kaydi; delta = +onHand.
 *   - release: rezervasyon birakildi. onHand DEGISMEZ (adet sayaca doner):
 *     delta 0, adet `quantity`'de. Kayit, siparisin nasil sonuclandigini da
 *     soyler (tekrar gelen birakma "zaten uygulandi" alir).
 * Onay (commit, delta = -adet) PR 2'de, sure dolumu (expire) T10.3'te eklenir.
 *
 * Burada depo yoktur; yalnizca kavramlar, port ve kayit kurallari.
 */

import type { ReservationLine, ReservationSettlement } from './reservation.js';

export const LEDGER_KINDS = {
  OPENING: 'opening',
  RELEASE: 'release',
} as const;

export type LedgerKind = (typeof LEDGER_KINDS)[keyof typeof LEDGER_KINDS];

/** Acilis kaydinin gerekcesi: seed (demo stogu). */
export const OPENING_REASON = 'seed';

export interface LedgerEntry {
  readonly marketId: string;
  readonly sku: string;
  readonly kind: LedgerKind;
  /** Eldeki adetteki (onHand) degisim. */
  readonly delta: number;
  /** Hareketin adedi: rezervasyonda kalemin adedi, acilista onHand. */
  readonly quantity: number;
  /** Gerekce anahtari: birakmada cagiranin (ornek "user_cancelled"). */
  readonly reason: string;
  /** Siparis hareketlerinde siparis; acilis kaydinda yok. */
  readonly orderId?: string;
  readonly at: Date;
}

/**
 * Kaydin kimligi: ayni hareket (siparis x sku x tur; acilista market x sku)
 * ayni kimlige duser ve ikinci kez yazilmaz (B14).
 */
export function ledgerEntryId(
  entry: Pick<LedgerEntry, 'marketId' | 'sku' | 'kind' | 'orderId'>,
): string {
  return entry.orderId === undefined
    ? `${entry.kind}/${entry.marketId}/${entry.sku}`
    : `${entry.orderId}/${entry.sku}/${entry.kind}`;
}

export interface StockLedger {
  /**
   * Kayitlari yazar. Ayni kayit (siparis x sku x tur) ikinci kez YAZILMAZ ve
   * hata da vermez (B14): yarida kalan birakmayi tamamlayan tekrar guvenlidir.
   */
  record(entries: readonly LedgerEntry[]): Promise<void>;
  /** Siparisin defterdeki sonucu; hic kaydi yoksa undefined. */
  settlementOf(marketId: string, orderId: string): Promise<ReservationSettlement | undefined>;
}

export interface ReleaseEntriesInput {
  readonly marketId: string;
  readonly orderId: string;
  readonly reason: string;
  readonly lines: readonly ReservationLine[];
  readonly at: Date;
}

/** Birakilan rezervasyonun kalem basina kaydi: onHand degismez (delta 0). */
export function releaseEntries(input: ReleaseEntriesInput): LedgerEntry[] {
  const { marketId, orderId, reason, lines, at } = input;
  return lines.map(({ sku, quantity }) => ({
    marketId,
    sku,
    kind: LEDGER_KINDS.RELEASE,
    delta: 0,
    quantity,
    reason,
    orderId,
    at,
  }));
}

/** Defterdeki tur -> siparisin sonucu (acilis bir siparis sonucu degildir). */
export function settlementOfKind(kind: LedgerKind): ReservationSettlement | undefined {
  return kind === LEDGER_KINDS.RELEASE ? 'released' : undefined;
}

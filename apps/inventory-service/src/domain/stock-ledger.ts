/**
 * Stok defteri (T10.2; roadmap veri modeli `stock_ledger`, ADR-18): her stok
 * hareketinin degismez kaydi. "Stok nereye gitti" sorusunun cevabi burada.
 *
 * Defter ELDEKI ADEDIN (onHand) hesabidir: bir market x SKU icin delta'larin
 * toplami onHand'e esittir (T10.2 bitti tanimi).
 *   - opening: seed'in acilis kaydi; delta = +onHand.
 *   - release: rezervasyon birakildi. onHand DEGISMEZ (adet sayaca doner):
 *     delta 0, adet `quantity`'de.
 *   - commit: odeme onaylandi, adet kalici dustu (T10.2 PR 2): delta = -adet.
 *     Eldeki adet AYNI transaction'da duser (StockCommitter).
 *   - expire: supurucu suresi dolani birakti (T10.3). onHand DEGISMEZ: delta 0.
 *   - extend: rezervasyon uzatildi (T11.3, B21). onHand DEGISMEZ: delta 0;
 *     siparisin sonucu degildir, kacinci uzatma oldugu `sequence`'tadir.
 * Sonuc kayitlari (release, commit, expire) siparisin nasil sonuclandigini da
 * soyler: tekrar gelen cagri "zaten uygulandi" alir.
 *
 * Burada depo yoktur; yalnizca kavramlar, port ve kayit kurallari.
 */

import type { ReservationLine, ReservationSettlement } from './reservation.js';

export const LEDGER_KINDS = {
  OPENING: 'opening',
  RELEASE: 'release',
  COMMIT: 'commit',
  EXPIRE: 'expire',
  EXTEND: 'extend',
} as const;

export type LedgerKind = (typeof LEDGER_KINDS)[keyof typeof LEDGER_KINDS];

/** Acilis kaydinin gerekcesi: seed (demo stogu). */
export const OPENING_REASON = 'seed';

/** Onay kaydinin gerekcesi: Commit istekte gerekce tasimaz, odeme onayi demektir. */
export const COMMIT_REASON = 'order_paid';

/** Sure dolumu kaydinin gerekcesi (supurucu, T10.3). */
export const EXPIRE_REASON = 'expired';

/** Uzatma kaydinin gerekcesi (T11.3): odeme adimi kilidi uzatti. */
export const EXTEND_REASON = 'payment_attempt';

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
  /** Ayni turden birden fazla kayit olabilen harekette sira (uzatma: 1, 2, 3). */
  readonly sequence?: number;
  readonly at: Date;
}

/**
 * Kaydin kimligi: ayni hareket (siparis x sku x tur [x sira]; acilista market
 * x sku) ayni kimlige duser ve ikinci kez yazilmaz (B14). Uzatmanin sirasi
 * kimlikte: ikinci uzatma birincinin uzerine dusmez, ayni uzatmanin tekrari duser.
 */
export function ledgerEntryId(
  entry: Pick<LedgerEntry, 'marketId' | 'sku' | 'kind' | 'orderId' | 'sequence'>,
): string {
  if (entry.orderId === undefined) {
    return `${entry.kind}/${entry.marketId}/${entry.sku}`;
  }
  const kind = entry.sequence === undefined ? entry.kind : `${entry.kind}-${entry.sequence}`;
  return `${entry.orderId}/${entry.sku}/${kind}`;
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

/** Onaylanan rezervasyonun kalem basina kaydi: eldeki adet duser (delta -adet). */
export function commitEntries(input: Omit<ReleaseEntriesInput, 'reason'>): LedgerEntry[] {
  const { marketId, orderId, lines, at } = input;
  return lines.map(({ sku, quantity }) => ({
    marketId,
    sku,
    kind: LEDGER_KINDS.COMMIT,
    delta: -quantity,
    quantity,
    reason: COMMIT_REASON,
    orderId,
    at,
  }));
}

/** Suresi dolan rezervasyonun kalem basina kaydi: onHand degismez (delta 0). */
export function expireEntries(input: Omit<ReleaseEntriesInput, 'reason'>): LedgerEntry[] {
  return releaseEntries({ ...input, reason: EXPIRE_REASON }).map((entry) => ({
    ...entry,
    kind: LEDGER_KINDS.EXPIRE,
  }));
}

export interface ExtendEntriesInput extends Omit<ReleaseEntriesInput, 'reason'> {
  /** Kacinci uzatma (1'den baslar). */
  readonly sequence: number;
}

/** Uzatilan rezervasyonun kalem basina kaydi: onHand degismez (delta 0). */
export function extendEntries(input: ExtendEntriesInput): LedgerEntry[] {
  const { sequence, ...rest } = input;
  return releaseEntries({ ...rest, reason: EXTEND_REASON }).map((entry) => ({
    ...entry,
    kind: LEDGER_KINDS.EXTEND,
    sequence,
  }));
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

/** Defterdeki tur -> siparisin sonucu (acilis ve uzatma bir siparis sonucu degildir). */
export function settlementOfKind(kind: LedgerKind): ReservationSettlement | undefined {
  switch (kind) {
    case LEDGER_KINDS.RELEASE:
      return 'released';
    case LEDGER_KINDS.COMMIT:
      return 'committed';
    case LEDGER_KINDS.EXPIRE:
      return 'expired';
    case LEDGER_KINDS.OPENING:
    case LEDGER_KINDS.EXTEND:
      return undefined;
  }
}

/** Onayin kalici yaziminin sonucu. */
export interface CommitWriteResult {
  /** Bu cagrida yazilan kalem sayisi (kaydi zaten olan kalem sayilmaz). */
  readonly written: number;
  /** Eldeki adedi eksiye dusen kalemler (fazla satis izi; onay yine yapildi). */
  readonly negative: readonly { readonly sku: string; readonly onHand: number }[];
}

/**
 * Onayin kalici yazimi (T10.2 PR 2, ADR-18): kalem basina defter kaydi (-adet)
 * ve eldeki adedin dusumu TEK transaction'da. Kaydi zaten olan kalem atlanir:
 * tekrar guvenlidir, adet iki kez dusmez. Eksiye dusmek reddedilmez (onay
 * yapilmistir; iz gizlenmez).
 */
export interface StockCommitter {
  commit(entries: readonly LedgerEntry[]): Promise<CommitWriteResult>;
}

/** Bir market x SKU'nun defterdeki delta toplami. */
export interface LedgerBalance {
  readonly marketId: string;
  readonly sku: string;
  readonly total: number;
}

/** Defter toplamlarinin okunmasi (defter = onHand denetimi, B24). */
export interface LedgerBalanceSource {
  balances(): Promise<readonly LedgerBalance[]>;
}

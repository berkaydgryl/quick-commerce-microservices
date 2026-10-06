/**
 * Rezervasyon script'lerinin CEVAP sozlesmesi: script'in cevabi DIS VERIDIR
 * (ADR-10) ve semadan gecer. Bes script'in (lua/; lua-scripts.ts yukler) cevap
 * semalari ve ortak cevaplarin (iz, aktif degil, kalem listesi) sonuca cevrilmesi.
 */

import { AppError } from '@getir/core';
import { z } from 'zod';

import type {
  CommitCommand,
  InactiveReservation,
  ReservationLine,
  SettledReservation,
} from '../../domain/reservation.js';

/** Lua tam sayisi ioredis'ten sayi, hash alani metin olarak gelir. */
const integerReply = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform(Number),
]);

/** Kalemin script'teki 1 tabanli sirasi. */
const lineIndex = integerReply.pipe(z.number().int().min(1));

export const reserveReplySchema = z.union([
  z.tuple([z.literal('reserved'), integerReply]),
  z.tuple([z.literal('already'), integerReply]),
  z.tuple([z.literal('user-active'), z.string().min(1)]),
  z.tuple([z.literal('insufficient'), lineIndex, integerReply]),
  z.tuple([z.literal('missing'), lineIndex]),
  z.tuple([z.literal('corrupt'), lineIndex]),
]);

const quantityReply = integerReply.pipe(z.number().int().min(1));

/** [sku, adet, sku, adet, ...] ciftleri (sira script'e gore). */
const pairsReply = z.union([z.string().min(1), z.number()]);

/** Daha once sonuclanmis kaydin izi: durum, gerekce, an, sonra ciftler. */
const settledReplySchema = z
  .tuple([
    z.literal('settled'),
    z.enum(['released', 'committed', 'expired']),
    z.string().min(1),
    integerReply,
  ])
  .rest(pairsReply);

export const releaseReplySchema = z.union([
  z.tuple([z.literal('released'), integerReply.pipe(z.number().int().min(0))]).rest(quantityReply),
  settledReplySchema,
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('stale')]),
  z.tuple([z.literal('not-due')]),
  z.tuple([z.literal('corrupt'), lineIndex]),
]);

export const commitReplySchema = z.union([
  z.tuple([z.literal('committed')]).rest(pairsReply),
  settledReplySchema,
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('stale')]),
]);

/** extend.lua ve shorten.lua'nin ortak "aktif degil" cevaplari ve eskimis on okuma. */
const inactiveReplies = [
  z.tuple([z.literal('settled')]),
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('due')]),
  z.tuple([z.literal('stale')]),
] as const;

export const extendReplySchema = z.union([
  z.tuple([z.literal('extended'), integerReply, integerReply]).rest(pairsReply),
  z.tuple([z.literal('limit'), integerReply, integerReply]),
  /** Beklenen bitis tutmadi (T15.3): guncel bitis, sayi, kalemler. */
  z.tuple([z.literal('mismatch'), integerReply, integerReply]).rest(pairsReply),
  ...inactiveReplies,
]);

export const shortenReplySchema = z.union([
  z.tuple([z.literal('shortened'), integerReply]),
  z.tuple([z.literal('unchanged'), integerReply]),
  ...inactiveReplies,
]);

/** Script'in "aktif degil" cevabi -> sonuc (yazilan bir sey yok). */
export function inactiveOf(reason: InactiveReservation['reason']): InactiveReservation {
  return { status: 'inactive', reason };
}

/** 'settled' cevabi -> iz. */
export function settledOf(
  reply: z.infer<typeof settledReplySchema>,
  command: CommitCommand,
): SettledReservation {
  const [, settlement, reason, settledAt, ...pairs] = reply;
  return { status: 'settled', settlement, reason, settledAt, lines: linesOf(pairs, command) };
}

/** Cevaptaki [sku, adet, sku, adet, ...] -> kalemler (sku sirasinda). */
export function linesOf(
  pairs: readonly (string | number)[],
  command: CommitCommand,
): ReservationLine[] {
  const parsed = z
    .array(z.tuple([z.string().min(1), quantityReply]))
    .safeParse(
      Array.from({ length: Math.ceil(pairs.length / 2) }, (_, index) =>
        pairs.slice(index * 2, index * 2 + 2),
      ),
    );
  if (!parsed.success) {
    throw AppError.internal('script bozuk kalem listesi dondurdu', {
      cause: parsed.error,
      details: { orderId: command.orderId, marketId: command.marketId },
    });
  }
  return parsed.data
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
}

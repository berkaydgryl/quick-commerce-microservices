/**
 * Goc 0003 (#166): kilidi dusup parasi iade edilen siparisin kalici iade
 * isareti. #166 oncesi bu siparislerde zaman cizelgesinde PAID ve iade izi yoktu;
 * Gecmis Siparislerim'den gizleniyordu. Tek kalici iz outbox'taki iade
 * komutudur (payment.refund_requested; aggregateId = siparis).
 *
 *   up   : her siparis icin EN ESKI iade komutu (occurredAt, esitlikte _id;
 *          belirlenimci) okunur; siparis CANCELLED ve isaretsizse tek $set ile
 *          refund {reason, requestedAt} ve inHistory: true yazilir. Isaretli ya
 *          da iptal edilmemis siparise dokunulmaz: tekrar calismasi zararsiz.
 *   down : refund alani silinir ve inHistory 0002'nin kuraliyla (durum + zaman
 *          cizelgesinde PAID) yeniden hesaplanir; eski kod isareti bilmez.
 *
 * KAPSAM: outbox satirlari silinmez (TTL indeksi yok, yayinci yalnizca
 * publishedAt isaretler; budama ADR-04'te kabul edilen borc). Komutu outbox'a
 * HIC yazilmamis iadeler kurtarilamaz: siparisi baska yolun iptal ettigi ve
 * dogrudan iadesi basarili olan eski kayitlar (refund-step.ts, komut yalnizca
 * dogrudan iade basarisizsa yazilir). Onlarin izi payment'tadir; order'in
 * gocu baska servisin verisini okumaz (ADR-05).
 *
 * Mantik o gunun DONMUS kopyasidir (ADR-19). Transaction'siz: outbox buyuk
 * olabilir (transaction sinirlari); her adim yeniden calistirilabilir.
 */

import type { Migration, MigrationContext } from '@getir/mongo-kit';
import type { AnyBulkWriteOperation, Collection, Document } from 'mongodb';
import { z } from 'zod';

const ORDERS = 'orders';
const OUTBOX = 'outbox';
const REFUND_REQUESTED = 'payment.refund_requested';
/** Toplu yazimin parti boyu: siparis basina tek gidis-donus yerine. */
const WRITE_BATCH = 500;

/** 0002'nin gorunurluk kurali (donmus): down inHistory'yi buna dondurur. */
const LISTED_STATUSES = ['PAID', 'PREPARING', 'ON_THE_WAY', 'DELIVERED', 'REVIEW'];
const IN_HISTORY_0002 = {
  $or: [
    { $in: ['$status', LISTED_STATUSES] },
    {
      $and: [
        { $eq: ['$status', 'CANCELLED'] },
        { $in: ['PAID', { $ifNull: ['$timeline.status', []] }] },
      ],
    },
  ],
};

/** Toplamanin satiri veritabanindan gelir: semadan gecer, bicimsizi atlanir. */
const refundRowSchema = z.object({
  _id: z.string(),
  reason: z.string(),
  requestedAt: z.date(),
});

/** Siparis basina en eski iade komutu: gerekce ve an. */
const EARLIEST_REFUND_PER_ORDER: Document[] = [
  { $match: { topic: REFUND_REQUESTED, 'payload.reason': { $type: 'string' } } },
  { $sort: { occurredAt: 1, _id: 1 } },
  {
    $group: {
      _id: '$aggregateId',
      reason: { $first: '$payload.reason' },
      requestedAt: { $first: '$occurredAt' },
    },
  },
];

async function up(context: MigrationContext): Promise<void> {
  const orders = context.db.collection(ORDERS);
  const refunds = context.db
    .collection(OUTBOX)
    .aggregate(EARLIEST_REFUND_PER_ORDER, { allowDiskUse: true });
  let marked = 0;
  let skipped = 0;
  let batch: AnyBulkWriteOperation<Document>[] = [];
  for await (const raw of refunds) {
    const row = refundRowSchema.safeParse(raw);
    if (!row.success) {
      skipped += 1;
      continue;
    }
    const { _id: orderId, reason, requestedAt } = row.data;
    batch.push({
      updateOne: {
        filter: { _id: orderId, status: 'CANCELLED', refund: { $exists: false } } as Document,
        update: { $set: { refund: { reason, requestedAt }, inHistory: true } },
      },
    });
    if (batch.length === WRITE_BATCH) {
      marked += await writeBatch(orders, batch);
      batch = [];
    }
  }
  marked += await writeBatch(orders, batch);
  context.logger.info({ marked, skipped }, 'iade isareti goc edildi');
}

/** Partiyi sirasiz yazar; degisen belge sayisi. Bos partide gidilmez. */
async function writeBatch(
  orders: Collection<Document>,
  batch: AnyBulkWriteOperation<Document>[],
): Promise<number> {
  if (batch.length === 0) {
    return 0;
  }
  const result = await orders.bulkWrite(batch, { ordered: false });
  return result.modifiedCount;
}

async function down(context: MigrationContext): Promise<void> {
  const result = await context.db
    .collection(ORDERS)
    .updateMany({ refund: { $exists: true } }, [
      { $unset: 'refund' },
      { $set: { inHistory: IN_HISTORY_0002 } },
    ]);
  context.logger.info({ cleared: result.modifiedCount }, 'iade isareti goci geri alindi');
}

export const refundMark: Migration = {
  version: 3,
  name: 'iade-isareti',
  transaction: false,
  up,
  down,
};

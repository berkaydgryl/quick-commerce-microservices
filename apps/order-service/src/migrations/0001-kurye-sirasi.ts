/**
 * Goc 0001 (T13.2, #92): kurye bekleyen siparislerin kuyruk sirasi. Isci
 * kurye bekleyenleri artik odeme anina gore dener (courierQueuedAt); alan
 * yeni odemelerde odeme adiminda yazilir. Bu goc, alan oncesi kayitlari
 * tamamlar.
 *
 *   up   : kuryesi olmayan PAID ve kuryesiz bekleyen PREPARING (deneme ani
 *          var) siparise courierQueuedAt = zaman cizelgesindeki odeme ani (yoksa
 *          olusturma ani). Alani olan belgeye dokunulmaz: tekrar calismasi
 *          zararsiz.
 *   down : alan silinir ve kuyruk indeksi (status_courierQueuedAt_id)
 *          dusurulur; eski kod ikisini de bilmez.
 *
 * Mantik o gunun DONMUS kopyasidir (ADR-19): domain'deki courierQueueTime
 * sonradan degisse de bu goc degismez. Indeks dusurmek transaction icinde
 * yapilamaz: goc transaction'siz, her adimi yeniden calistirilabilir.
 */

import type { Migration, MigrationContext } from '@getir/mongo-kit';
import type { Document } from 'mongodb';

const ORDERS = 'orders';
const QUEUE_INDEX = 'status_courierQueuedAt_id';

/** Zaman cizelgesindeki ilk PAID kaydinin ani; yoksa olusturma ani. */
const PAID_AT = {
  $ifNull: [
    {
      $getField: {
        field: 'at',
        input: {
          $first: {
            $filter: { input: '$timeline', cond: { $eq: ['$$this.status', 'PAID'] } },
          },
        },
      },
    },
    '$createdAt',
  ],
};

async function up(context: MigrationContext): Promise<void> {
  const result = await context.db.collection(ORDERS).updateMany(
    {
      courierQueuedAt: { $exists: false },
      courier: { $exists: false },
      $or: [{ status: 'PAID' }, { status: 'PREPARING', courierRetryAt: { $exists: true } }],
    },
    [{ $set: { courierQueuedAt: PAID_AT } }],
  );
  context.logger.info({ queued: result.modifiedCount }, 'kurye kuyrugu goc edildi');
}

async function down(context: MigrationContext): Promise<void> {
  const orders = context.db.collection(ORDERS);
  const result = await orders.updateMany(
    { courierQueuedAt: { $exists: true } },
    { $unset: { courierQueuedAt: '' } },
  );
  const collections = await context.db
    .listCollections({ name: ORDERS }, { nameOnly: true })
    .toArray();
  if (collections.length > 0) {
    const indexes = await orders.listIndexes().toArray();
    if (indexes.some((description: Document) => description['name'] === QUEUE_INDEX)) {
      await orders.dropIndex(QUEUE_INDEX);
    }
  }
  context.logger.info({ cleared: result.modifiedCount }, 'kurye kuyrugu goci geri alindi');
}

export const courierQueue: Migration = {
  version: 1,
  name: 'kurye-sirasi',
  transaction: false,
  up,
  down,
};

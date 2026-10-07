/**
 * Goc 0002 (#101, T11.16): Gecmis Siparislerim sunucuda suzulur. Siparis
 * belgesi turetilmis `inHistory` alanini tasir (esleme her yazimda domain
 * kuralindan hesaplar); ListMyOrders yalnizca `true` olanlari kismi indeksten
 * okur. Bu goc, alan oncesi kayitlari doldurur.
 *
 *   up   : alani olmayan her siparise inHistory = durum PAID, PREPARING,
 *          ON_THE_WAY, DELIVERED ya da REVIEW; ya da CANCELLED ve zaman
 *          cizelgesinde PAID kaydi var (odendikten sonra iptal). Digerleri
 *          false. Alani olan belgeye dokunulmaz: tekrar calismasi zararsiz.
 *   down : alan silinir ve gecmis indeksi (userId_createdAt_id_inHistory)
 *          dusurulur; eski kod ikisini de bilmez.
 *
 * Mantik o gunun DONMUS kopyasidir (ADR-19): domain'deki isListedInHistory
 * sonradan degisse de bu goc degismez. Indeks dusurmek transaction icinde
 * yapilamaz: goc transaction'siz, her adimi yeniden calistirilabilir.
 */

import type { Migration, MigrationContext } from '@getir/mongo-kit';
import type { Document } from 'mongodb';

const ORDERS = 'orders';
const HISTORY_INDEX = 'userId_createdAt_id_inHistory';
const LISTED_STATUSES = ['PAID', 'PREPARING', 'ON_THE_WAY', 'DELIVERED', 'REVIEW'];

/** Gecmiste gorunur mu: listelenen durum ya da zaman cizelgesinde PAID olan iptal. */
const IN_HISTORY = {
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

async function up(context: MigrationContext): Promise<void> {
  const result = await context.db
    .collection(ORDERS)
    .updateMany({ inHistory: { $exists: false } }, [{ $set: { inHistory: IN_HISTORY } }]);
  context.logger.info({ marked: result.modifiedCount }, 'gecmis gorunurlugu goc edildi');
}

async function down(context: MigrationContext): Promise<void> {
  const orders = context.db.collection(ORDERS);
  const result = await orders.updateMany(
    { inHistory: { $exists: true } },
    { $unset: { inHistory: '' } },
  );
  const collections = await context.db
    .listCollections({ name: ORDERS }, { nameOnly: true })
    .toArray();
  if (collections.length > 0) {
    const indexes = await orders.listIndexes().toArray();
    if (indexes.some((description: Document) => description['name'] === HISTORY_INDEX)) {
      await orders.dropIndex(HISTORY_INDEX);
    }
  }
  context.logger.info({ cleared: result.modifiedCount }, 'gecmis gorunurlugu goci geri alindi');
}

export const historyVisibility: Migration = {
  version: 2,
  name: 'gecmis-gorunurlugu',
  transaction: false,
  up,
  down,
};

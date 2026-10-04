/**
 * Goc 0001 (T13.2): kurye havuzu. Kurye artik bir markete BAGLI DEGIL;
 * siparisin marketinin cevresindeki bos kuryelerden biri atanir. Bunun icin:
 *
 *   up   : couriers.lastLocation {lat, lng} -> GeoJSON Point (2dsphere icin);
 *          marketId silinir; IDLE kuryeye bosta bekleme baslangici (idleSince:
 *          son atama ani, hic atanmamissa seed ani); eski atama indeksi
 *          (marketId_status_lastAssignedAt) dusurulur; markets koleksiyonuna
 *          21 demo marketin konumu yazilir (yoksa eklenir, varsa guncellenir).
 *   down : tersi. marketId, kuryenin konumuna EN YAKIN marketten yazilir (eski
 *          kod alanin dolu olmasini bekler); 2dsphere indeksi ve markets
 *          koleksiyonu dusurulur.
 *
 * Mantik ve market listesi o gunun DONMUS kopyasidir (ADR-19): fixtures ya da
 * domain sonradan degisse de bu goc degismez. Indeks dusurmek transaction
 * icinde yapilamaz: goc transaction'siz ve her adimi yeniden calistirilabilir.
 */

import type { Migration, MigrationContext } from '@getir/mongo-kit';
import type { AnyBulkWriteOperation, Document } from 'mongodb';

/** O gunun belge bicimleri (donmus): yalnizca bu gocun dokundugu alanlar. */
interface MarketRow {
  _id: string;
  location: { type: 'Point'; coordinates: [number, number] };
}

interface CourierRow {
  _id: string;
  lastLocation: { lat: number; lng: number };
}

const COURIERS = 'couriers';
const MARKETS = 'markets';
const OLD_ASSIGNMENT_INDEX = 'marketId_status_lastAssignedAt';
const POOL_INDEX = 'lastLocation_2dsphere_status';
/** Konum cevrilirken kullanilan gecici alan; goc bitince belgede kalmaz. */
const LOCATION_SCRATCH = 'goc0001Konum';
const EARTH_RADIUS_METERS = 6_378_100;

/** 21 demo marketin konumu (T13.2 gunu, catalog fixtures/markets.ts): [kimlik, enlem, boylam]. */
const MARKETS_AT_T132: readonly (readonly [string, number, number])[] = [
  ['mkt_migros-jet-moda', 40.985, 29.0275],
  ['mkt_a101-caferaga', 40.9895, 29.024],
  ['mkt_kardesler-manavi', 40.9905, 29.029],
  ['mkt_migros-jet-besiktas', 41.0425, 29.008],
  ['mkt_carrefour-express-barbaros', 41.046, 29.007],
  ['mkt_a101-abbasaga', 41.045, 29.002],
  ['mkt_sok-moda', 40.9864, 29.0309],
  ['mkt_moda-kasabi', 40.9901, 29.032],
  ['mkt_moda-sarkuteri', 40.984, 29.0297],
  ['mkt_altiyol-kuruyemis', 40.9939, 29.0288],
  ['mkt_bahariye-firini', 40.9885, 29.0345],
  ['mkt_pati-pet-shop-kadikoy', 40.9939, 29.0322],
  ['mkt_moda-cicekcilik', 40.9813, 29.0297],
  ['mkt_bim-sinanpasa', 41.0447, 29.0013],
  ['mkt_carsi-manavi', 41.0413, 29.0006],
  ['mkt_barbaros-kasabi', 41.0488, 29.0071],
  ['mkt_besiktas-sarkuteri', 41.0391, 29.0007],
  ['mkt_yildiz-kuruyemis', 41.0495, 29.0102],
  ['mkt_abbasaga-firini', 41.0478, 28.9996],
  ['mkt_pati-pet-shop-besiktas', 41.0505, 29.0035],
  ['mkt_lale-cicekcilik', 41.0416, 28.996],
];

async function exists(context: MigrationContext, name: string): Promise<boolean> {
  return (await context.db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

async function dropIndexIfExists(
  context: MigrationContext,
  collection: string,
  index: string,
): Promise<void> {
  if (!(await exists(context, collection))) {
    return;
  }
  const indexes = await context.db.collection(collection).listIndexes().toArray();
  if (indexes.some((description: Document) => description['name'] === index)) {
    await context.db.collection(collection).dropIndex(index);
  }
}

/**
 * lastLocation'i verilen bicimle DEGISTIREN guncelleme boru hatti. Boru
 * hattinda `$set: { lastLocation: { ... } }` gomulu belgeyi eskisiyle
 * BIRLESTIRIR ({lat, lng, type, coordinates} olurdu); once ara alana yazilir,
 * sonra alan yolu ifadesiyle yerine konur.
 */
function replaceLocation(shape: Document): Document[] {
  return [
    { $set: { [LOCATION_SCRATCH]: shape } },
    { $set: { lastLocation: `$${LOCATION_SCRATCH}` } },
    { $unset: LOCATION_SCRATCH },
  ];
}

function haversine(latA: number, lngA: number, latB: number, lngB: number): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(latB - latA) / 2) ** 2 +
    Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(radians(lngB - lngA) / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearestMarket(lat: number, lng: number): string {
  let best = MARKETS_AT_T132[0]?.[0] ?? '';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [marketId, marketLat, marketLng] of MARKETS_AT_T132) {
    const distance = haversine(lat, lng, marketLat, marketLng);
    if (distance < bestDistance) {
      best = marketId;
      bestDistance = distance;
    }
  }
  return best;
}

async function up(context: MigrationContext): Promise<void> {
  const couriers = context.db.collection<CourierRow>(COURIERS);
  const located = await couriers.updateMany(
    { 'lastLocation.type': { $exists: false } },
    replaceLocation({ type: 'Point', coordinates: ['$lastLocation.lng', '$lastLocation.lat'] }),
  );
  const unbound = await couriers.updateMany(
    { marketId: { $exists: true } },
    { $unset: { marketId: '' } },
  );
  const idle = await couriers.updateMany({ status: 'IDLE', idleSince: { $exists: false } }, [
    { $set: { idleSince: { $ifNull: ['$lastAssignedAt', '$lastLocationAt'] } } },
  ]);
  await dropIndexIfExists(context, COURIERS, OLD_ASSIGNMENT_INDEX);
  const markets: AnyBulkWriteOperation<MarketRow>[] = MARKETS_AT_T132.map(
    ([marketId, lat, lng]) => ({
      updateOne: {
        filter: { _id: marketId },
        update: { $set: { location: { type: 'Point', coordinates: [lng, lat] } } },
        upsert: true,
      },
    }),
  );
  await context.db.collection<MarketRow>(MARKETS).bulkWrite(markets, { ordered: false });
  context.logger.info(
    {
      located: located.modifiedCount,
      unbound: unbound.modifiedCount,
      idle: idle.modifiedCount,
      markets: markets.length,
    },
    'kurye havuzu goc edildi',
  );
}

async function down(context: MigrationContext): Promise<void> {
  const couriers = context.db.collection<CourierRow>(COURIERS);
  await dropIndexIfExists(context, COURIERS, POOL_INDEX);
  await couriers.updateMany(
    { 'lastLocation.type': 'Point' },
    replaceLocation({
      lat: { $arrayElemAt: ['$lastLocation.coordinates', 1] },
      lng: { $arrayElemAt: ['$lastLocation.coordinates', 0] },
    }),
  );
  const all = await couriers
    .find({ marketId: { $exists: false } }, { projection: { lastLocation: 1 } })
    .toArray();
  const bound: AnyBulkWriteOperation<CourierRow>[] = all.map((courier) => ({
    updateOne: {
      filter: { _id: courier._id },
      update: {
        $set: { marketId: nearestMarket(courier.lastLocation.lat, courier.lastLocation.lng) },
      },
    },
  }));
  if (bound.length > 0) {
    await couriers.bulkWrite(bound, { ordered: false });
  }
  await couriers.updateMany({ idleSince: { $exists: true } }, { $unset: { idleSince: '' } });
  if (await exists(context, MARKETS)) {
    await context.db.collection(MARKETS).drop();
  }
  context.logger.info({ bound: bound.length }, 'kurye havuzu goci geri alindi');
}

export const courierPool: Migration = {
  version: 1,
  name: 'kurye-havuzu',
  transaction: false,
  up,
  down,
};

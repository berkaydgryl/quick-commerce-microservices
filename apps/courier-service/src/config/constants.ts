/** Kurye servisinin is sabitleri (ADR-11). */

import { COURIER_ROUTE_MAX_POINTS } from '@getir/contracts';

export const SERVICE_NAME = 'courier';

/** Proto'daki tam servis adi; saglik kaydi ve gunluk bunu kullanir. */
export const COURIER_SERVICE_FULL_NAME = 'getir.courier.v1.CourierService';

/** Roadmap'teki port haritasindan: courier 50056. */
export const DEFAULT_COURIER_GRPC_PORT = 50_056;

/**
 * Servisin kendi veritabani (D14, ADR-05): COURIER_MONGO_DB verilmezse.
 * Kullanicisi (COURIER_MONGO_URI) yalnizca burada yetkilidir.
 */
export const DEFAULT_MONGO_DB = 'getir_courier';

/**
 * Varis tahmini hesaplanamadiginda (rota yok: siparisin marketi kopyada
 * bulunamadi) atama cevabindaki deger. 0 = "hesaplanmadi".
 */
export const ETA_NOT_COMPUTED_SECONDS = 0;

/**
 * Rota (T13.2): kurye -> market -> adres, buyuk daire uzerinde esit aralikli
 * noktalar. Nokta sayisi ceil(toplam m / 100), 20 ile 40 arasina kirpilir
 * (proto Route.points: 20-40 nokta).
 */
export const ROUTE_POINT_SPACING_METERS = 100;
export const ROUTE_MIN_POINTS = 20;
/** Takip sozlesmesi rotayi bu sinirla dogrular: tek kaynak @getir/contracts. */
export const ROUTE_MAX_POINTS = COURIER_ROUTE_MAX_POINTS;

/**
 * Kurye hizi (km/sa): ETA = toplam yol / hiz. Ortamdan (COURIER_SPEED_KMH,
 * .env.example) okunur; tam sayi, bu sinirlar icinde.
 */
export const DEFAULT_COURIER_SPEED_KMH = 20;
export const COURIER_SPEED_KMH_MIN = 1;
export const COURIER_SPEED_KMH_MAX = 120;

/**
 * Kurye havuzu (T13.2, domain/courier-pool.ts): marketin 3 km cevresindeki
 * bos kuryeler. Demo verisinde iki semtin en yakin market cifti 4,9 km ayri;
 * semt icinde en uzak cift 2,6 km (07.10 subeleriyle). Yaricap iki semti
 * kendiliginden ayirir (test/unit/courier-fixtures.spec.ts denetler).
 */
export const COURIER_POOL_RADIUS_METERS = 3_000;

/**
 * Yakinlik dilimi (#88): ayni 300 m'lik dilimdeki kuryeler "esit yakin"
 * sayilir, aralarinda en uzun suredir bosta olan secilir.
 */
export const COURIER_PROXIMITY_BAND_METERS = 300;

/**
 * Atomik talep (B7): sira kuralina gore bir okumada en fazla 5 aday okunur ve
 * sirayla "hala IDLE ise" kosuluyla alinmaya calisilir. Baskasina gidenler
 * sonraki okumada dislanir; havuzda bos kurye kalmayinca "bos kurye yok".
 */
export const COURIER_CLAIM_CANDIDATES = 5;

/** Demo seed'inde her marketin yakinina konan kurye sayisi (33 x 3 = 99). */
export const DEMO_COURIERS_PER_MARKET_AREA = 3;

/**
 * Siparisin markette hazirlanma suresi (sn; T13.3): kurye markete erken
 * varirsa paketi bu sure dolunca alir. Gercekci varsayilan 5 dk; demo icin
 * .env ORDER_PREP_SECONDS=30.
 */
export const DEFAULT_ORDER_PREP_SECONDS = 300;
export const ORDER_PREP_SECONDS_MIN = 0;
export const ORDER_PREP_SECONDS_MAX = 3_600;

/** Tick araligi (ms; T13.3): rotalar bu aralikla ilerletilir, kilometre taslari yayinlanir. */
export const DEFAULT_COURIER_TICK_MS = 2_000;
export const COURIER_TICK_MS_MIN = 200;
export const COURIER_TICK_MS_MAX = 60_000;

/**
 * Tick liderlik kilidinin omru (ms): max(tick x 5, 10 sn). Lider duserse baska
 * ornek en gec bu kadar sonra devralir. Alt sinir: kisa tick'te (200 ms) omur
 * tek bir Mongo zaman asimindan (2 sn) kisa kalmasin. Turun sure butcesi
 * omrun yarisi (route-ticker.ts): tur kilit dusmeden biter.
 */
export const COURIER_TICK_LOCK_TTL_MULTIPLIER = 5;
export const COURIER_TICK_LOCK_MIN_TTL_MS = 10_000;
export const COURIER_TICK_BUDGET_DIVISOR = 2;

/** Bir turda ilerletilen en fazla rota; fazlasi sonraki turda (eskiden yeniye). */
export const TICK_BATCH_SIZE = 200;

/**
 * BUSY kalan kurye uzlastirmasi (#205): tick en fazla bu aralikla (ms) siparisi
 * tasiyan kuryeleri (en eski atama once, TICK_BATCH_SIZE kadar) ve rotalarini
 * TOPLU okur. Normal yolda hicbir sey yazmaz; araligi tick'ten uzun tutmak
 * okuma maliyetini sinirlar.
 */
export const CARRIER_RECONCILE_INTERVAL_MS = 30_000;

/**
 * Uzlastirmanin bekleme payi (ms): rota en az bu kadar once bitmis (ENDED ya da
 * teslim) olmali. ReleaseCourier'in kendi birakmasiyla (ayni istek) yarismasin.
 */
export const CARRIER_RECONCILE_GRACE_MS = 30_000;

/**
 * Canli konum kaydinin omru (ms; courier:{id}:last): max(30 sn, tick x 3).
 * Kurye durunca konum kendiliginden duser; tick araligindan hep uzun.
 */
export const COURIER_LIVE_LOCATION_TTL_MS = 30_000;
export const COURIER_LIVE_LOCATION_TTL_TICKS = 3;

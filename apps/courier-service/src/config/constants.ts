/** Kurye servisinin is sabitleri (ADR-11). */

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
 * Atamadaki ilk varis tahmini. Rota ve ETA T13.2 PR 3'un isidir (kurye ->
 * market -> adres, COURIER_SPEED_KMH); o gelene kadar 0 = "henuz hesaplanmadi".
 * Sozlesmede eta_seconds proto3 sayisidir, gonderilmeyen deger de 0 okunur.
 */
export const ETA_NOT_COMPUTED_SECONDS = 0;

/**
 * Kurye havuzu (T13.2, domain/courier-pool.ts): marketin 3 km cevresindeki
 * bos kuryeler. Demo verisinde Kadikoy ile Besiktas 6,6 km ayri; semt icinde
 * en uzak market cifti 1,4 km. Yaricap iki semti kendiliginden ayirir.
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

/** Demo seed'inde her marketin yakinina konan kurye sayisi (21 x 3 = 63). */
export const DEMO_COURIERS_PER_MARKET_AREA = 3;

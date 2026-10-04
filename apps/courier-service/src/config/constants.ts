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
 * Atamadaki ilk varis tahmini. Rota ve ETA T13.2'nin isidir (market -> adres
 * polyline'i, COURIER_SPEED_KMH); o gelene kadar 0 = "henuz hesaplanmadi".
 * Sozlesmede eta_seconds proto3 sayisidir, gonderilmeyen deger de 0 okunur.
 */
export const ETA_NOT_COMPUTED_SECONDS = 0;

/** Demo seed'inde her markete dusen kurye sayisi (T13.1). */
export const COURIERS_PER_MARKET = 3;

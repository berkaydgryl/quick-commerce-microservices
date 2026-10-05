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
export const ROUTE_MAX_POINTS = 40;

/**
 * Kurye hizi (km/sa): ETA = toplam yol / hiz. Ortamdan (COURIER_SPEED_KMH,
 * .env.example) okunur; tam sayi, bu sinirlar icinde.
 */
export const DEFAULT_COURIER_SPEED_KMH = 20;
export const COURIER_SPEED_KMH_MIN = 1;
export const COURIER_SPEED_KMH_MAX = 120;

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

/**
 * Siparis servisinin sabitleri.
 */

/** Gunlukte ve acilis kaydinda gorunen kisa ad. */
export const SERVICE_NAME = 'order';

/** Health tablosunda ve grpcurl cagrilarinda kullanilan tam nitelikli ad. */
export const ORDER_SERVICE_FULL_NAME = 'getir.order.v1.OrderService';

/** Roadmap'teki port haritasindan: order 50053. */
export const DEFAULT_ORDER_GRPC_PORT = 50_053;

/**
 * Servisin kendi veritabani (D14, ADR-05): ORDER_MONGO_DB verilmezse.
 * Kullanicisi (ORDER_MONGO_URI) yalnizca burada yetkilidir.
 */
export const DEFAULT_MONGO_DB = 'getir_order';

// Idempotency anahtari ve sepet sinirlari burada TEKRAR YAZILMAZ: REST sozlesmesiyle
// ayni kaynaktan (@getir/contracts) gelir; iki kapida iki farkli sinir olmasin.

/** Catalog'un varsayilan adresi (roadmap port haritasi: catalog 50051). */
export const DEFAULT_CATALOG_GRPC_ADDR = 'localhost:50051';

/**
 * order -> catalog cagrisinin sure siniri (ms). Taslak acma kullanicinin
 * bekledigi yoldadir: catalog takilirsa SERVICE_UNAVAILABLE ile hizli donmek,
 * gateway'in kendi 5 sn'lik sinirina (GATEWAY_REQUEST_TIMEOUT_MS) takilmaktan iyidir.
 */
export const CATALOG_CALL_TIMEOUT_MS = 2_000;

/** Risk ve odeme servislerinin varsayilan adresleri (roadmap port haritasi). */
export const DEFAULT_RISK_GRPC_ADDR = 'localhost:50055';
export const DEFAULT_PAYMENT_GRPC_ADDR = 'localhost:50054';

/**
 * Saga cagrilarinin sure sinirlari (ms), T7.1. CreateOrder'da ikisi arka arkaya
 * calisir ve toplami gateway'in 5 sn'lik sinirinin ALTINDA kalmali
 * (GATEWAY_REQUEST_TIMEOUT_MS): once order kendi hatasini (SERVICE_UNAVAILABLE)
 * dondurmeli. Risk kurallari kendi zaman asimlariyla sinirlidir, 1 sn yeter;
 * odeme bankaya gittigi icin daha uzun.
 */
export const RISK_CALL_TIMEOUT_MS = 1_000;
export const PAYMENT_CALL_TIMEOUT_MS = 3_000;

/** Stok servisinin varsayilan adresi (roadmap port haritasi: inventory 50052). */
export const DEFAULT_INVENTORY_GRPC_ADDR = 'localhost:50052';

/**
 * order -> inventory cagrisinin sure siniri (ms), T11.2. Reserve/Commit/Release
 * tek Lua script'i (milisaniyeler); 1 sn risk cagrisiyla ayni. CreateOrder'in
 * basarili yolunda risk + odeme + kesinlestirme ardisik calisir ve sinirlarin
 * toplami (1 + 3 + 1 sn) gateway'in 5 sn'sine ESITTIR: uc cagri da sinirina yakin
 * surerse gateway once keser. Zarar yok: siparis AWAITING_PAYMENT kalir, ayni
 * istegin tekrari cekimin ilk sonucunu alir (idempotent) ve kesinlestirmeyi yeniden
 * dener; para iki kez cekilmez, stok iki kez dusmez.
 */
export const INVENTORY_CALL_TIMEOUT_MS = 1_000;

/** Kurye servisinin varsayilan adresi (roadmap port haritasi: courier 50056). */
export const DEFAULT_COURIER_GRPC_ADDR = 'localhost:50056';

/**
 * order -> courier cagrisinin sure siniri (ms), T13.1 PR 2. Atama ve birakma
 * tek findOneAndUpdate; cagri kullanicinin bekledigi yolda degil (isci), yine
 * de takilan courier turu uzatmasin diye inventory ile ayni 1 sn.
 */
export const COURIER_CALL_TIMEOUT_MS = 1_000;

/**
 * Kurye atayan isci (T13.1 PR 2): 1 sn'de bir tur, turda en fazla 100 siparis.
 * Odenen siparis en gec ~1 sn sonra kuryeyle PREPARING'e gecer. Markette bos
 * kurye yoksa siparis kuryesiz PREPARING'de bekler ve 30 sn sonra yeniden
 * denenir (roadmap saga tablosu, B7).
 */
export const COURIER_DISPATCH_INTERVAL_MS = 1_000;
export const COURIER_DISPATCH_BATCH_SIZE = 100;
export const COURIER_RETRY_DELAY_MS = 30_000;

/**
 * Atama yazilamazsa (surum cakismasi) siparis yeniden okunup karar yeniden
 * verilir; en fazla bu kadar yazim denemesi. Cakisma yalnizca eszamanli
 * yazimda olur (ikinci order ornegi, iptal); ucuncude de surerse siparis
 * sonraki turda ele alinir.
 */
export const COURIER_ASSIGNMENT_WRITE_ATTEMPTS = 3;

/**
 * Stok kilidinin omru (sn), RESERVATION_TTL_SECONDS. Sinirlar inventory'nin
 * kabul ettigiyle ayni (30-900); banda gore kisaltma (orta risk 120 sn) T11.3.
 */
export const DEFAULT_RESERVATION_TTL_SECONDS = 600;
export const MIN_RESERVATION_TTL_SECONDS = 30;
export const MAX_RESERVATION_TTL_SECONDS = 900;

/**
 * Banda gore kilit (T11.3, roadmap "Bantlar ve aksiyonlar"): orta risk bandinda
 * kilidin kalan suresi risk adiminda en cok bu kadar (sn), RESERVATION_TTL_MEDIUM_RISK_SECONDS.
 * Sinirlar kilit suresiyle ayni (30-900).
 */
export const DEFAULT_MEDIUM_RISK_RESERVATION_SECONDS = 120;

/**
 * Odeme oncesi uzatma (T11.3, B21, #72), RESERVATION_EXTEND_SECONDS: odeme ya
 * da 3DS denemesinden once kalan sure bundan azsa kilit bu kadar uzatilir
 * (inventory'de rezervasyon basina en cok 3 kez). Sinir inventory'ninkiyle
 * ayni (1-300). Kalan sure yetiyorsa uzatma cagrisi YAPILMAZ: CreateOrder'in
 * zaman butcesi (#69) normal yolda degismez.
 */
export const DEFAULT_RESERVATION_EXTEND_SECONDS = 60;
export const MIN_RESERVATION_EXTEND_SECONDS = 1;
export const MAX_RESERVATION_EXTEND_SECONDS = 300;

export const MS_PER_SECOND = 1_000;

/**
 * Gateway'in doldurdugu risk sinyali metinlerinin (IP, sehir, cihaz kimligi)
 * en uzun hali (T7.5). Deger yorumlanmaz, risk-svc'ye tasinir; sinir yalnizca
 * sinirsiz metnin kapidan gecmemesi icindir (IPv6 45 karakterdir).
 * Kupon kodu siniri REST ile ortak oldugu icin contracts'tadir (COUPON_CODE_MAX_LENGTH).
 */
export const MAX_SIGNAL_TEXT_LENGTH = 128;

/** Iptal gerekcesi anahtarinin en uzun hali (ornek: "CHANGED_MIND"). */
export const MAX_CANCEL_REASON_LENGTH = 64;

/**
 * Outbox yayincisi (T7.3, roadmap "Outbox akisi"): 500 ms'de bir tur, turda en
 * fazla 100 olay. Tam dolu parti cikarsa beklemeden devam edilir; aralik
 * yalnizca kuyruk bosken beklenir (yayin gecikmesinin ust siniri ~500 ms).
 */
export const OUTBOX_POLL_INTERVAL_MS = 500;
export const OUTBOX_BATCH_SIZE = 100;

/**
 * Kilidi dolan siparisleri kapatan supurucu (T11.2 PR 2), ORDER_SWEEPER_INTERVAL_MS.
 * Kullaniciya gorunen davranis supurucuye bagli degil (kilidi dusmus taslak
 * CreateOrder'da 410 alir); tur kayitlari ve parayi toparlar, 10 sn yeter.
 * Turda en fazla 100 siparis: birikmis kuyruk dakikada 600 siparis erir.
 */
export const DEFAULT_ORDER_SWEEPER_INTERVAL_MS = 10_000;
export const MIN_ORDER_SWEEPER_INTERVAL_MS = 1_000;
export const MAX_ORDER_SWEEPER_INTERVAL_MS = 600_000;
export const ORDER_SWEEPER_BATCH_SIZE = 100;

/**
 * Giden cagrilarin dayanikliligi (D17; infrastructure/grpc-resilience.ts).
 * Devre: bagimli servise ust uste 5 "ulasilamaz" hatada 10 sn cagri yapilmaz,
 * sonra tek deneme cagrisi. Yeniden deneme: yalnizca idempotent cagrida, en
 * fazla 2 kez, ~100 ve ~200 ms arayla; denemeler cagrinin sure sinirini paylasir
 * (CreateOrder'in zaman butcesi degismez).
 */
export const DEPENDENCY_BREAKER_FAILURE_THRESHOLD = 5;
export const DEPENDENCY_BREAKER_OPEN_MS = 10_000;
export const IDEMPOTENT_RETRY_MAX = 2;
export const IDEMPOTENT_RETRY_BASE_DELAY_MS = 100;

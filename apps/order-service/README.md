# @getir/order-service

Sipariş gerçeğinin ve checkout saga'sının **tek sahibi** (ADR-05): `orders` ve `outbox`
koleksiyonları. Sipariş durumunu **yazabilen tek yer** burasıdır; başka servis durumu
değiştiremez, yalnızca bu servisin RPC'lerini çağırır.

Bu serviste **olmayanlar**, bilinçli: stok sayacı `inventory-service`'in, kart çekimi
`payment-service`'in, skor hesabı `risk-service`'in işidir. Risk **bandının aksiyonu** ise
(kapıda ödeme kapalı, rezervasyon süresi, reddet) burada verilir — risk servisi yalnızca
skor önerir.

## Bugünkü durum (T13.2 PR 2 — kurye kuyruğu ödeme sırasıyla)

| RPC                | Durum                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CreateDraftOrder` | ✅ Fiyatı catalog'dan okur, sunucuda hesaplar, `expected_total` ile karşılaştırır; tutarı taslakta dondurur (T7.2); stoku kilitler (T11.2)             |
| `CreateOrder`      | ✅ Saga (T7.1): risk-svc → bant kararı → payment-svc çekimi → stok kesinleşir (T11.2); `PAID`, `PAYMENT_FAILED`, 3DS ya da `REVIEW`/`REJECTED`         |
| `ConfirmPayment`   | ✅ 3DS kodu (T7.1): doğruysa stok kesinleşir ve `PAID`; hak biter / süre dolarsa `PAYMENT_FAILED`, kilit bırakılır                                     |
| `GetOrder`         | ✅ Tek sipariş, zaman çizelgesi dahil; başkasının siparişi `NOT_FOUND`                                                                                 |
| `ListMyOrders`     | ✅ Yeniden eskiye, imleçle sayfalı; yalnızca geçmişte görünen siparişler (#101, aşağıda "Geçmiş kapsamı"); sipariş yoksa boş liste                     |
| `CancelOrder`      | ✅ Kullanıcı iptali: yalnızca `DRAFT`, `RESERVED`, `AWAITING_PAYMENT` (B29); Idempotency-Key zorunlu (D4); kilit bırakılır; parası alınmışsa iptal yok |

RPC'lerin yanında iki işçi çalışır: kilidi dolan siparişleri kapatan süpürücü (T11.2 PR 2) ve
ödenen siparişe courier-svc'den kurye isteyen kurye işçisi (T13.1 PR 2; sırası T13.2 PR 2'de ödeme
anına göre, aşağıda "Kurye ataması").

## Veri kaynağı: Mongo ya da MOCK

| `MOCK` | Kaynak                                                      | Gerekenler                                                                                               |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `true` | Bellek (`infrastructure/memory`); olaylar bellekte          | Yok; yeniden başlayınca unutur, **olay yayını kapalı**; persona geçmişi açılışta yüklenir (T8.1)         |
| değil  | `orders` + `outbox` koleksiyonları (`infrastructure/mongo`) | `ORDER_MONGO_URI` (kendi veritabanı `getir_order`, D14) ve `REDIS_URL` zorunlu (yayın `stream:events`'e) |

İki uygulama **aynı sözleşme testinden** geçer (`test/support/order-store-contract.ts`): birim
testinde bellek, entegrasyon testinde gerçek Mongo. Depoyu seçip açan tek yer
`infrastructure/order-store.ts`'tir; indeksler açılışta kurulur.

**Üç port, her use-case yalnızca ihtiyacını alır:** `OrderRepository` (`insert`, `update`,
`findById`) taslak açan, ilerleten ve iptal eden use-case'lerin; `OrderHistoryReader`
(`listByUser`, `hasPaidOrder`, `riskHistory`) okuyanların; `OrderOutbox` (`append`, `pending`,
`markPublished`) olay yayıncısının ve saga'nın telafi komutunun (T7.3).

**İyimser kilit (`version`).** Yeni taslak 1'dir, her geçiş bir artırır. `update(order,
expectedVersion)` yalnızca kayıttaki sürüm okunanla aynıysa yazar (Mongo'da
`replaceOne({ _id, version })`). Aynı taslağa eş zamanlı iki `CreateOrder` ya da
`CreateOrder` + `CancelOrder` gelirse ikincisi `CONFLICT` alır; "son yazan kazanır" yoktur.

**Geçmiş sırası ve imleç.** Liste `createdAt` azalan, eşitlikte kimlik azalan sıralıdır;
kimlik rastgele olduğu için tek başına zaman sırası vermez. Sayfa jetonu `(createdAt, id)`
taşır ve istemci için opaktır (`interfaces/grpc/page-token.ts`). Offset yerine imleç: kullanıcı
listeyi gezerken yeni sipariş verirse offset kayar. Sayfa boyutu sözleşme sınırlarına
oturtulur (0 → 20, 100 üstü → 100); bu sınırlar REST ile aynı yerden, `@getir/contracts`'tan
gelir.

**Geçmiş kapsamı (#101, T11.16).** `ListMyOrders` yalnızca kullanıcının gerçekten verdiği
siparişleri döner; süzme sunucudadır, sayfa tam dolar. Kural tek yerde,
`domain/order-history-listing.ts` (`isListedInHistory`; tablo `Record<OrderStatus, …>`, yeni durum
derlemede karar ister):

| Geçmişte | Durum                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Görünür  | `PAID`, `PREPARING`, `ON_THE_WAY`, `DELIVERED`, `REVIEW`; `CANCELLED` ve zaman çizelgesinde `PAID` kaydı var (ödendikten sonra iptal: "İptal edildi · İade edildi")                                       |
| Gizli    | `DRAFT`, `RISK_CHECK`, `RESERVED`, `AWAITING_PAYMENT`, `EXPIRED`, `PAYMENT_FAILED`, `REJECTED`; ödenmeden iptal (sepeti bırakma, yeni sepet, stok yetmedi, kilit düştü, kullanıcının ödeme öncesi iptali) |

- **Saklama:** Mongo belgesinde türetilmiş `inHistory` (boolean). Sipariş her yazımda bütün belge
  olarak yazıldığı için eşleyici (`mappers.ts`) alanı her yazımda kuraldan hesaplar; okumada
  kullanılmaz. Bellek deposu aynı kuralla süzer (aynı sözleşme testi,
  `test/support/order-history-listing-contract.ts`).
- **Sorgu:** `{ userId, inHistory: true }` + imleç, kısmi indeksten (aşağıdaki tablo,
  `infrastructure/mongo/history-query.ts`). Gizli sipariş okunup atılmaz: okunan belge dönen satır
  kadardır (explain testli). İndeks adıyla istenir (`hint`): aynı anahtarlı tam indeks de sorguya
  uyar ve plan yarışı eşit biterse planlayıcı onu seçip önbelleğe alabilirdi. Bedeli: indeks yoksa
  sorgu yavaşlamaz, hata verir (indeks açılışta kurulur; göç 0002 geri alınınca eski kod beklenir).
  İmleçli sayfada `createdAt <= imleç` aralığı daraltır; önceki sayfaların anahtarları yeniden
  taranmaz.
- **Kenar (kabul):** `REVIEW`'dan onaylanıp ödeme bekleyen sipariş (`RESERVED`,
  `AWAITING_PAYMENT`) listeden çıkar, ödenince geri gelir.
- **Göç 0002 (`gecmis-gorunurlugu`):** alan öncesi kayıtlara `inHistory`'yi durum ve zaman
  çizelgesinden yazar (o günün kuralının donmuş kopyası, ADR-19); alanı olana dokunmaz. `down` alanı
  ve kısmi indeksi kaldırır. Transaction'sız ve yeniden çalıştırılabilir (indeks düşürmek
  transaction'da yapılamaz).
- **Sözleşme:** tel biçimi (`order.proto`) değişmedi; değişen, listenin kapsamı. Gateway'in kendi
  süzmesi (`orderhistory.Visible`, en fazla 3 tur) artık bir şey elemez; temizliği ayrı iş.
- **Bilinen sınır (dağıtım):** göç, eski kopyalar kapandıktan sonraki açılışı varsayar. Eski sürümlü
  bir kopya göçten sonra siparişi bütün belge olarak yeniden yazarsa (`replaceOne`) `inHistory`
  silinir ve sipariş geçmişte görünmez; son durumdaki (`DELIVERED`, iptal) sipariş bir daha
  yazılmadığı için bu KALICIDIR. Onarım: yeni kodla `migrate down` + `migrate up` (alanı olmayanları
  doldurur), sonra servis yeniden başlatılır (kısmi indeks açılışta kurulur). Bugün tek order
  kopyası çalışır; çok kopyalı dağıtımda önce eski kopyalar kapanır.

| Koleksiyon | İndeks                                                                                              | Sorgu                               |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `orders`   | `{ userId: 1, createdAt: -1, _id: -1 }` (`userId_createdAt_id`)                                     | risk geçmişi, ILK10, persona seed'i |
| `orders`   | `{ userId: 1, createdAt: -1, _id: -1 }` (`userId_createdAt_id_inHistory`), kısmi: `inHistory: true` | `ListMyOrders` (#101)               |
| `orders`   | `{ status: 1, 'reservation.expiresAt': 1, _id: 1 }` (`status_reservationExpiresAt_id`)              | süpürücü (T11.2 PR 2)               |
| `orders`   | `{ status: 1, courierRetryAt: 1, _id: 1 }` (`status_courierRetryAt_id`), kısmi                      | kurye işçisi (T13.1)                |
| `orders`   | `{ status: 1, courierQueuedAt: 1, _id: 1 }` (`status_courierQueuedAt_id`), kısmi                    | kurye kuyruğu (#92)                 |

Roadmap veri modelindeki `status` indeksi süpürücüyle (T11.2 PR 2) geldi: durum (`$in`, iki
değer) + kilidin bitişi aralığı ve aynı sıraya göre okuma tek indeksten, bellekte sıralama yok
(explain testli).

Kurye işçisinin indeksi **kısmi**: yalnızca `PAID` ve `PREPARING` siparişler girer (teslim
edilen ve iptal edilen geçmiş girmez). Sorgunun iki kolu (`$or`: bütün `PAID`'ler; deneme anı
gelmiş kuryesiz `PREPARING`'ler) aynı indeksten okunur ve `SORT_MERGE` ile birleşir (explain testli).

Kurye kuyruğunun indeksi (#92) de **kısmi**: yalnızca kuryesiz bekleyen `PREPARING` (deneme anı
olan) girer; kurye atanınca alan silinir, sipariş indeksten çıkar. Yeni talepten önce ödemiş
bekleyenler ödeme sırasıyla buradan okunur; bellekte sıralama yok, okunan anahtar dönen kadar
(explain testli).

**Kalemler ve tutarlar:** proto `Order`'daki fiyatlı kalemler (`items`) ve tutarlar (`subtotal`,
`delivery_fee`, `discount`, `total`) taslakta dondurulan değerlerdir (T7.2); `GetOrder` onları
olduğu gibi döner. `reservation_expires_at` yalnızca stok kilidi canlıyken (`DRAFT`, `RESERVED`,
`AWAITING_PAYMENT`) doludur (T11.2). **Bilerek boş bırakılan:** `dark_store_id` (okunmaz, ADR-15);
`market_id` zorunlu ve `mkt_` biçimlidir.

### Durum makinesi (`src/domain/order-state-machine.ts`)

Her geçiş tek bir tablodan geçer (`ORDER_TRANSITIONS`, roadmap diyagramı + B20 + B29); tabloda
olmayan geçiş `ORDER_STATE_INVALID` fırlatır (gRPC `FAILED_PRECONDITION`) ve ayrıntıda
`{ orderId, from, to }` taşır. Durumu değiştirmenin tek yolu `transitionOrder`'dır: tabloyu
kontrol eder ve `timeline[]`'a bir kayıt **ekler** (durum, zaman, isteğe bağlı not anahtarı).
Tablo `Record<OrderStatus, …>`: `@getir/core`'a yeni durum eklenip tabloya eklenmezse derleme
kırılır. Testi tabloyu diyagramdaki kenar listesiyle **birebir** karşılaştırır; ayrıca her durum
`DRAFT`'tan erişilebilir ve her ara durumdan bir son duruma varılabilir.

**Geçici notlar kalktı:** risk adımının `PENDING_RISK_SERVICE`'i T7.1'de, stok adımının
`PENDING_RESERVATION`'ı T11.2'de. Stok artık taslakta gerçekten kilitlenir; `RESERVED` geçişi
notsuz yazılır. Eski kayıtlarda not durur, okuyan bir şey yok.

**Kullanıcı iptali (B29):** kullanıcı yalnızca `DRAFT`, `RESERVED` ve `AWAITING_PAYMENT`
durumundaki **kendi** siparişini iptal edebilir (`USER_CANCELLABLE`). `PAID → CANCELLED` tabloda
var ama sistemin telafi adımıdır (iade, B20c). Gerekçe bir anahtardır (`CHANGED_MIND`); yoksa
taslakta `CART_RELEASED` (sepeti bırakmak, T11.4: gateway `DELETE /v1/cart/reserve/{orderId}`; risk
geçmişinde iptal sayılmaz, inventory'ye `cart_released`), diğer durumlarda `USER_CANCELLED` yazılır.
İptalden sonra stok kilidi bırakılır (T11.2). Ödeme bekleyen siparişte önce payment-svc'deki kayda
bakılır: para alınmışsa ya da kart çekimi sürüyorsa iptal edilmez (`REQUEST_IN_PROGRESS`; T11.2 PR 2,
aşağıda). Zaten iptal edilmiş sipariş `ORDER_STATE_INVALID` alır, ayrıntıda `status: CANCELLED`
(gateway bunu "zaten bırakılmış" sayar). Sistemin iptal notları (`STOCK_INSUFFICIENT`,
`RESERVATION_EXPIRED`, `CART_REPLACED`, `CART_RELEASED`) gerekçe olarak kabul edilmez
(`INVALID_ARGUMENT`): risk geçmişi o notlu iptalleri saymaz, kullanıcı kendi iptalini böyle
gizleyemez.

## Neden `CreateDraftOrder` de bu görevde

Görev tanımı `CreateOrder` diyor, ama `CreateOrderRequest` bir `order_id` bekler: kimliği
üreten uç `CreateDraftOrder`'dır (B8 — "rezervasyon, henüz olmayan bir siparişin kimliğiyle
açılamaz"). "grpcurl ile orderId döner" ölçütünü karşılayan uç budur; ikisi birlikte
olmadan zincir denenemezdi.

## İki karar

**Başkasının siparişinde `NOT_FOUND`, `PERMISSION_DENIED` değil.** Sözleşmede yazılı:
"bu kimlikte bir sipariş var" bilgisi bile sızdırılmamalıdır. Yetki hatası dönmek, sipariş
kimliklerini deneyerek varlık taraması yapmayı mümkün kılardı.

**Idempotency anahtarı bugünden zorunlu (ADR-08).** Dört mutasyon da (`CreateDraftOrder`,
`CreateOrder`, `ConfirmPayment`, `CancelOrder`) anahtar ister; servis yalnızca varlığını ve uzunluğunu (8–128,
`@getir/contracts`) doğrular. Tekrar koruması (`idem:{key}`, aynı anahtara ilk cevabın
dönmesi) ADR-08 gereği gateway'dedir ve T8.2'de gelir. Erken zorunlu tutmanın sebebi:
istemciler göndermeye bugün alışsın, koruma açıldığında sözleşme değişmesin.

## Sunucu tarafı fiyat (T7.2)

Tutar istemciye güvenilmeden sunucuda hesaplanır ve **taslakta dondurulur**; `CreateOrder` ve
saga (T7.1) yeniden hesaplamaz, kullanıcı rezervasyon boyunca gördüğü fiyattan öder.

1. **Catalog'dan tek seferde:** `GetMarket` (minimum sepet, teslimat ücreti, ücretsiz eşik) ve
   `BatchGetOffers` (sepetteki ürünlerin o marketteki fiyatları, N+1 yok) paralel çağrılır.
   İsteğin `x-request-id`'si catalog'a **aynen** gider; çağrının süre sınırı 2 sn
   (`CATALOG_CALL_TIMEOUT_MS`). Adres `CATALOG_GRPC_ADDR` (gateway'le aynı değişken).
2. **Hesap web'le aynı fonksiyon:** `@getir/pricing` `calculateCart`. ILK10'un "ilk sipariş mi"
   sorusunu order kendi kaydından cevaplar (`hasPaidOrder`, yalnızca kupon girildiyse).
3. **`sku` isteğe bağlı (T7.5):** REST sepeti sku taşımaz; kaleme catalog teklifinin sku'su
   yazılır. Verildiyse (eski istemci, grpcurl) teklifle eşleşmeli, yoksa `skuMismatchProductIds`.
   Kupon kodu sınırı REST ile ortaktır: contracts `COUPON_CODE_MAX_LENGTH` (32).
4. **Kontrol sırası ve hatalar** (hiçbirinde taslak açılmaz):

| Durum                                      | Kod (gRPC)                                 | Ayrıntı                                    |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| Ürün o markette satılmıyor / sku uyuşmuyor | `VALIDATION_FAILED` (INVALID_ARGUMENT)     | `unavailableProductIds`, `skuMismatch…`    |
| Kupon uygulanamadı                         | `COUPON_INVALID`                           | `couponCode`, `reason`                     |
| Minimum sepet altı                         | `MIN_BASKET_NOT_MET` (FAILED_PRECONDITION) | `amountToMinBasketMinor`, `minBasketMinor` |
| `expected_total` sunucunun toplamı değil   | `PRICE_CHANGED` (ABORTED)                  | `expectedTotalMinor`, `totalMinor`         |
| Catalog'a ulaşılamadı / süre doldu         | `SERVICE_UNAVAILABLE` (UNAVAILABLE)        | —                                          |

## Sipariş saga'sı (T7.1)

```text
DRAFT → RISK_CHECK → RESERVED → AWAITING_PAYMENT → PAID
                  ↘ REVIEW / REJECTED            ↘ PAYMENT_FAILED
```

**1. Risk adımı** (`application/risk-step.ts`, kurallar `domain/checkout-risk.ts`)

Order, risk-svc'ye yalnızca **sunucuda bildiklerini** gönderir (B9, istemciden sinyal alınmaz):
sepet toplamı, teslimat konumu, market, kullanıcının teslim edilen / iptal edilen sipariş sayısı
ve teslim edilenlerin ortalama sepeti (`OrderHistoryReader.riskHistory`, tek aggregation) ve
stok kilidinden siparişe geçen süre (checkout-dwell, başlangıç `reservedAt`; kilidi olmayan eski
taslakta taslağın açıldığı an). İptal sayısına sistemin taslak iptalleri (stok yetmedi, süre
doldu, sepet yenilendi) girmez: kullanıcı davranışı değildir (T11.2).

**Gateway sinyalleri (T7.5):** IP, IP şehri, cihaz, cihazdaki hesap sayısı, önceki IP, oturum
konumu ve hesap yaşını gateway bilir; `CreateOrderRequest.signals` (`CheckoutSignals`) ile gelir
ve order onları **yorumlamadan** `RiskContext`'teki aynı adlı alanlara taşır
(`infrastructure/risk/grpc-risk-assessment.ts`). Bugün gateway yalnızca bağlantının IP'sini
doldurur; diğerleri T8.1'de oturumdan gelir. Boş metin, 0 ve gönderilmeyen mesaj "yok" demektir:
eksik sinyal kuralı tetiklemez. Metinler en fazla 128 karakter (`MAX_SIGNAL_TEXT_LENGTH`).

| Bant       | Sipariş                                        | Cevap                                                                       |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `LOW`      | devam; kapıda ödeme açık                       | —                                                                           |
| `MEDIUM`   | devam; kart + 3DS zorunlu (`require_three_ds`) | kapıda ödeme seçildiyse `PAYMENT_METHOD_NOT_ALLOWED`, sipariş `DRAFT` kalır |
| `HIGH`     | `REVIEW` (manuel inceleme)                     | `RISK_REVIEW` (REST 202)                                                    |
| `CRITICAL` | `REJECTED`                                     | `RISK_BLOCKED` (REST 403)                                                   |

Risk-svc'ye ulaşılamazsa **hiçbir şey yazılmaz**: riski atlayarak ödeme alınmaz. Bant siparişe
yazılır (`riskBand`, proto'da yok — istemciye gösterilmez).

**2. Ödeme adımı** (`application/payment-step.ts`, kurallar `domain/checkout-payment.ts`)

Sipariş önce `AWAITING_PAYMENT` olarak **kaydedilir**, sonra `Charge` çağrılır. Tutar taslakta
dondurulan toplamdır; idempotency anahtarı siparişten türetilir (`charge-<orderId>`): bir sipariş
asla iki kez çekilmez.

| Ödeme sonucu                | Sipariş                             | Cevap                             |
| --------------------------- | ----------------------------------- | --------------------------------- |
| Onay                        | `PAID`                              | —                                 |
| Kapıda ödeme (`PENDING`)    | `PAID`, not `CASH_ON_DELIVERY`      | —                                 |
| 3DS                         | `AWAITING_PAYMENT`                  | `challenge_id` → `ConfirmPayment` |
| Red / sağlayıcı hatası      | `PAYMENT_FAILED`, not hata anahtarı | `PAYMENT_DECLINED` (ya da nedeni) |
| Kartlı çekim hâlâ `PENDING` | değişmez (eş zamanlı istek sürüyor) | `REQUEST_IN_PROGRESS`             |
| Kayıtlı kart kasada yok     | `AWAITING_PAYMENT`, kilit yerinde   | `NOT_FOUND` (`resource: card`)    |

**Tekrar deneme:** çekim cevabı kaybolursa (payment-svc'ye ulaşılamadı) sipariş `AWAITING_PAYMENT`
kalır. Aynı `CreateOrder` tekrar gelince risk yeniden sorulmaz (kayıtlı bandın kuralı geçerli);
çekim aynı anahtarla gider, payment-svc ikinci kez çekmez.

**Kayıtlı kart (T12.4):** kartlı ödemede `card_id` (kullanıcının kasasındaki kart) ya da
`card_token` (DEPRECATED test jetonu), tam biri; kapıda ödemede ikisi de boş (payment-svc'deki
kuralla aynı). Kart yoksa, silinmişse ya da başkasınınsa payment-svc `NOT_FOUND` (ayrıntı yalnızca
`resource: card`) döner ve kayıt yazmaz; order hatayı aynen geçirir. Sipariş `AWAITING_PAYMENT`
kalır, kilit yerindedir; aynı sipariş başka kartla yeniden verilir (anahtar harcanmamıştır, eski
sonuç dönmez). Eş zamanlı iki denemeden kartı bulunamayan siparişe hiçbir şey yazmaz. 3DS
istendiyse cevapta `challenge_expires_at` döner (payment-svc'nin penceresi, çekimden 60 sn).

**Sipariş ayrıntıları (T12.4):** `details` gRPC'de **zorunludur** (kapıda ödemede de): hediye
(alıcı adı ve telefonu, gönderici adı, mesaj), kuryeye not, "Zili Çalma" ve sözleşme onayı.
Kurallar tek kaynaktan, `@getir/contracts` `checkout-rules.ts`; hata cümleleri değeri yankılamaz.
Ayrıntı risk adımının yazımında siparişe girer, onayın anı sunucu saatidir. Tekrar denemede ilk
yazılan geçerlidir; farklı gelen yok sayılır ve değeri yazılmadan INFO düşer (T12.4 öncesi ödeme
bekleyen sipariş tekrar denemede ayrıntı almaz; kilit ömrü kadar geçici). Yalnızca `GetOrder`
(sahibine) döndürür; `ListMyOrders` ve geçmiş döndürmez. Kişisel veri günlüğe, hata ayrıntısına ve
olaylara (outbox) girmez; Mongo'da `details` alt belgesindedir (saklama süresi bekleyen iş 133).

**Kapıda ödeme (T12.4):** `payment_method = CASH_ON_DELIVERY` ile `on_delivery` zorunludur: nakit
(`CASH`) ya da kuryenin POS cihazından kart (`POS`); kartla ödemede boş olmalıdır, kart alanı da
kapıda ödemede boş. Seçim (yöntem ve tür) risk adımının yazımında `Order.payment` olarak siparişe
girer, Mongo'da `payment` alt belgesidir; `GetOrder` ve liste döndürür (kişisel veri değil). LOW
bantta çekim yok, sipariş `PAID` (not `CASH_ON_DELIVERY`); MEDIUM bantta `PAYMENT_METHOD_NOT_ALLOWED`
ve sipariş taslakta kalır, aynı sipariş kartla verilir. Ödeme bekleyen siparişin tekrarında yöntem ya
da tür değişirse `CONFLICT` (ayrıntıda `field`: `paymentMethod` ya da `onDelivery`): çekimi değiştirir;
ayrıntı farkı ise sessizce yok sayılır. Bilinen sınırlar: teslimde tahsilat kaydı yok (T13.3), tür
kurye servisine taşınmıyor (bekleyen iş 146), kapıda ödemeli kilit kurtarma (bekleyen iş 128).

**3. Telafi (P3):** çekim başarılı ama sipariş `PAID` yazılamadı (sürüm çakışması — örneğin
kullanıcı tam o anda iptal etti) → tutar **iade edilir** (`Refund`, anahtar `refund-<orderId>`),
istemci `CONFLICT` alır. Çakışmayı aynı ödemenin eş zamanlı tekrarı yazdıysa (sipariş zaten
`PAID`) iade yapılmaz. Doğrudan iade de başarısız olursa `payment.refund_requested` komutu
outbox'a yazılır (WARN; payment-svc dinleyip iade eder, T7.4); komut da yazılamazsa son çare
ERROR günlüğü. İstemci her durumda `CONFLICT` alır. Eş zamanlı yazımda kaybedenin gerçekten
`CONFLICT` alması mongo-kit'in transaction yeniden denemesine dayanır (aşağıda, T7.3).

**3DS onayı (`ConfirmPayment`):** kod payment-svc'ye aynen iletilir. Yanlış kodda payment-svc'nin
`THREEDS_FAILED`'ı (kalan hak, sebep) istemciye aynen döner, sipariş bekler. Hak biterse ya da
süre dolarsa sipariş önce `PAYMENT_FAILED` yazılır, hata yine aynı. Sipariş zaten `PAID` ise
(onay cevabı kaybolmuş) payment-svc'ye gidilmez, aynı sonuç döner.

Adresler `RISK_GRPC_ADDR` (varsayılan `localhost:50055`) ve `PAYMENT_GRPC_ADDR`
(`localhost:50054`); süre sınırları 1 sn ve 3 sn. Stok kesinleştirmesiyle (1 sn, aşağıda)
sınırların toplamı gateway'in 5 sn'sine eşittir; üç çağrı da sınırına yakın sürerse gateway
önce keser, sipariş `AWAITING_PAYMENT` kalır ve tekrar isteği işi zararsızca tamamlar
(`config/constants.ts`).

**Dayanıklılık (D17, `infrastructure/grpc-resilience.ts`):** dört bağımlı servisin (catalog, risk,
payment, inventory) her birine bir devre kesici var. Üst üste 5 "ulaşılamaz" hatada devre açılır;
10 sn boyunca o servise çağrı yapılmaz, istek beklemeden `SERVICE_UNAVAILABLE` alır. Sonra tek bir
deneme çağrısı devreyi kapatır ya da yeniden açar.

Yalnızca idempotent çağrılar yeniden denenir (en fazla 2 kez, ~100/200 ms arayla, çağrının süre
sınırı içinde):

- catalog `GetMarket` ve `BatchGetOffers`;
- payment `Charge` (anahtarlı), `Refund` ve `GetPayment`;
- inventory `Reserve`, `Commit` ve `Release`.

Denenmeyenler:

- risk `Evaluate`: her çağrı yeni bir değerlendirme kaydı yazar;
- payment `Confirm3Ds`: tekrar, 3DS hakkını boşa yakabilir.

Süre bütçesi değişmedi: denemeler çağrının kendi sınırını paylaşır.

## Stok kilidi (T11.2)

Stok **taslak açılırken** inventory'de kilitlenir (`Reserve`, `application/draft-reservation.ts`),
ödeme alınınca `PAID` yazılmadan **önce** kesinleşir (`Commit`), saga durursa bırakılır
(`Release`, `application/stock-step.ts`). Kilit ömrü `RESERVATION_TTL_SECONDS` (varsayılan 600,
inventory'nin sınırlarıyla 30–900); banda göre kısaltma ve ödeme öncesi uzatma aşağıda (T11.3). Kilit siparişe `reservation`
(`reservedAt`, `expiresAt`) olarak yazılır; adres `INVENTORY_GRPC_ADDR` (gateway'le aynı
değişken), süre sınırı 1 sn.

| An                                           | Ne olur                                                                                    | Cevap                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Taslak, stok yeterli                         | kilitlenir; taslak kilidiyle tek yazımda kaydedilir                                        | `reservation_expires_at` dolu              |
| Taslak, stok yetmedi                         | taslak iz olarak `CANCELLED` (not `STOCK_INSUFFICIENT`) yazılır                            | `STOCK_INSUFFICIENT` (sku, istenen, kalan) |
| Taslak, kullanıcının eski taslağı kilitli    | eski taslak `CANCELLED` (`CART_REPLACED`), kilidi bırakılır, yeni sepet kilitlenir         | yeni taslak                                |
| Taslak, kullanıcının ödeme bekleyen siparişi | dokunulmaz (B22: kullanıcı başına tek aktif kilit)                                         | `RESERVATION_ACTIVE` (`activeOrderId`)     |
| Taslak, saga'nın bırakamadığı eski kilit     | durmuş siparişin (iptal, ret, inceleme, ödeme hatası) kilidi şimdi bırakılır               | yeni taslak                                |
| Taslak yazılamadı                            | kilit hemen bırakılır (`draft_not_saved`)                                                  | depo hatası                                |
| Taslak, Reserve cevabı belirsiz (T15.3)      | aynı sipariş için telafi Release (`draft_not_saved`); taslak açılmaz                       | Reserve'in hatası (`SERVICE_UNAVAILABLE`)  |
| Taslak, kilidin sipariş kaydı yok (yetim)    | yaşı > 30 sn ve aynı markette ise bırakılır (`stale_lock`), yeni sepet kilitlenir          | yeni taslak; değilse `RESERVATION_ACTIVE`  |
| `CreateOrder`, kilit süresi dolmuş taslak    | `CANCELLED` (`RESERVATION_EXPIRED`), kilit bırakılır; risk sorulmaz, ödeme alınmaz         | `RESERVATION_EXPIRED` (REST 410)           |
| Risk `REVIEW` / `REJECTED`, kart reddi       | kilit bırakılır (`risk_review`, `risk_rejected`, `payment_failed`)                         | adımın kendi hatası                        |
| Ödeme alındı                                 | `Commit`, sonra `PAID`                                                                     | —                                          |
| Ödeme alındı ama kilit düşmüş (`NOT_FOUND`)  | `CANCELLED` + iade komutu aynı yazımda, sonra doğrudan iade (`reservation_expired`)        | `RESERVATION_EXPIRED`                      |
| `Commit`'e ulaşılamadı                       | sipariş `AWAITING_PAYMENT` kalır; tekrar isteği aynı çekimi alıp yeniden kesinleştirir     | `SERVICE_UNAVAILABLE`                      |
| Kullanıcı iptali                             | kilit bırakılır (`user_cancelled`)                                                         | `CANCELLED`                                |
| İptal, ödeme bekleyen ve parası alınmış      | iptal edilmez; saga tamamlar ya da kilit dolunca süpürücü kapatır (`PAID` ya da iade)      | `REQUEST_IN_PROGRESS` (`paymentStatus`)    |
| Süpürücü, kilidi dolmuş taslak               | `CANCELLED` (`RESERVATION_EXPIRED`), kilit bırakılır                                       | —                                          |
| Süpürücü, kilidi dolmuş ödeme bekleyen       | önce ödeme: alınmışsa `CANCELLED` + iade, çekim sürüyorsa sonraki tur, değilse `CANCELLED` | —                                          |
| Süpürücü, parası alınmış, stoğu kesinleşmiş  | `PAID` (iş 124): ilk deneme `PAID` yazamamıştı; iade yok, kilit bırakılmaz                 | —                                          |

- **Bırakma en iyi gayretle:** başarısızsa WARN yazılır, saga sonucunu yine döner; kilit süresi
  dolunca inventory'nin süpürücüsü stoku geri verir. Bu arada kullanıcı yeni sepet açarsa eski
  kilit orada bulunup bırakılır (tablonun beşinci satırı).
- **Yetim kilit (T15.3, iş 126):** Reserve inventory'de uygulanıp cevabı kaybolursa kilit order'ın
  bilmediği sipariş adına kalır. İki savunma: belirsiz Reserve hatasında aynı sipariş hemen bırakılır;
  kaçarsa (gecikmiş yazım) kullanıcının sonraki sepeti kilidi bırakır. Yaş = kilit ömrü − inventory'nin
  bildirdiği kalan ömür (`activeExpiresInMs`); eşik `ORPHAN_LOCK_MIN_AGE_SECONDS` (30 sn), daha genç
  kilit eşzamanlı ikinci sekmenin olabilir. Yaşı bilinmeyen (eski inventory) ya da başka marketteki
  yetim (bekleyen iş 132) bırakılmaz. Bırakma WARN satırı (`orphanOrderId`, `ageMs`) ve
  `order_orphan_locks_released_total` sayacıyla görünür. Kilit süresi yayılım sırasında artırılırsa
  taze kilit eski görünebilir.
- **Neden önce `Commit`:** "ödendi ama stok kesinleşmedi" durumu oluşmasın. Kesinleşmiş stok için
  ödeme her zaman alınmıştır ya da iade yolundadır.
- **T11.2 öncesi kayıtlar:** kilidi olmayan taslak `CreateOrder`'da süresi dolmuş sayılır (kilitsiz
  stokla ödeme alınmaz); kilidi olmayan, ödeme bekleyen eski sipariş kesinleştirilmeden `PAID` olur.
- **Tahsil edilmemiş ödeme kapanır (PR 3):** sipariş `AWAITING_PAYMENT` ya da `PAID`'den
  `CANCELLED`'a geçince `statusChangedEvents` `order.status_changed`'in ardından
  `payment.cancel_requested` üretir; iptal eden her yazım (kullanıcı, süpürücü, kilidi düşmüş ödeme)
  aynı fonksiyonu kullandığı için komut unutulamaz ve siparişle aynı transaction'dadır. Kapıda
  ödemenin `PENDING`'ini ve 3DS bekleyen kartı payment `CANCELLED` yapar; alınmış tutarı ise iade
  eder (bekleyen iş 134; payment README).
- **Devre kesici (D17, PR 4):** inventory istemcisi de bağımlılık başına devreli; kısaltma tekrar
  güvenli olduğu için yeniden denenir. Uzatma T15.3'ten beri (bekleyen iş 117, QA IQ3) beklenen bitişle
  gider ve o da yeniden denenir: cevabı kaybolan uzatmanın tekrarı bitişi değişmiş bulur, hak harcamaz.

### Banda göre kilit ve ödeme öncesi uzatma (T11.3)

Kilit taslakta uzun süreyle alınır, risk ödeme adımında sorulur. Kilidin süresi saga'da iki yerde
ayarlanır (`application/lock-timing.ts`; inventory `ShortenReservation`, `ExtendReservation`):

| An                                               | Ne olur                                                                                                   | Cevap                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Risk `LOW`                                       | kilit taslaktaki gibi                                                                                     | —                              |
| Risk `MEDIUM`                                    | kalan süre en çok `RESERVATION_TTL_MEDIUM_RISK_SECONDS` (120); yeni bitiş risk kararıyla **aynı** yazımda | `reservation_expires_at` yeni  |
| Risk `HIGH` / `CRITICAL`                         | kısaltılmaz; kilit bırakılır (`REVIEW` / `REJECTED`, değişmedi)                                           | `RISK_REVIEW` / `RISK_BLOCKED` |
| Çekim ya da 3DS onayı öncesi, kalan süre ≥ 60 sn | inventory'ye gidilmez (CreateOrder'ın zaman bütçesi, #69, değişmez)                                       | —                              |
| Aynı an, kalan süre < 60 sn                      | `RESERVATION_EXTEND_SECONDS` (60) uzatılır; yeni bitiş **hemen** yazılır (sürüm +1, olay yok)             | —                              |
| Uzatmada bitiş siparişinkinden farklı (T15.3)    | hak harcanmaz; güncel bitiş yazılır; kalan süre hâlâ < 60 sn ise yeni beklenenle bir tur daha             | —                              |
| Uzatma hakkı bitmiş (inventory'de 3)             | süre aynı, WARN; ödeme kalan süreyle (kesinleştirmede kilit düşmüşse iade, değişmedi)                     | —                              |
| Kısaltma ya da uzatmada kilit düşmüş             | `CANCELLED`, kilit bırakılır; para çekilmez, 3DS gönderilmez; önceki deneme çektiyse iade (iş 122)        | `RESERVATION_EXPIRED` (410)    |
| Kilit düşmüş, para alınmış, stok kesinleşmiş     | `PAID` yazılır (iş 124); yeniden çekim, 3DS ve iade yok                                                   | başarı (`PAID`)                |
| Kilit düşmüş, kart çekimi sürüyor (T15.3)        | hiçbir şey yazılmaz; çekim bitince saga ya da süpürücü kapatır (`lapsed-order.ts`)                        | `REQUEST_IN_PROGRESS`          |
| Kilit düşmüş, payment'a ulaşılamadı              | hiçbir şey yazılmaz; sipariş `AWAITING_PAYMENT` kalır, kilit bırakılmaz                                   | `SERVICE_UNAVAILABLE`          |
| Kilit düşmüş, kapatma çakıştı                    | başka yol iptal ettiyse 410 (para alınmışsa yine iade); sipariş ilerlediyse (`PAID`) 409                  | 410 ya da `CONFLICT`           |
| inventory'ye ulaşılamadı                         | hiçbir şey yazılmaz; risk adımında sipariş `DRAFT`, ödemede `AWAITING_PAYMENT` kalır                      | `SERVICE_UNAVAILABLE`          |

- **Kilidi düşmüş siparişin kapatılması (T15.3, iş 122):** karar `application/lapsed-order.ts`'te,
  süpürücüyle aynı tablo. Para alınmışsa iade komutu (`payment.refund_requested`) `CANCELLED` ile
  **aynı yazımda** kaydedilir (servis hemen çökse de kaybolmaz), ardından doğrudan iade denenir.
  Komut iadeden sonra da gelse payment "zaten iade edilmiş" der; para iki kez geri verilmez.
- **Para alınmışsa önce `Commit` (T15.3, iş 124):** inventory kesinleşmiş kilidin uzatma ve
  kısaltmasına da `RESERVATION_EXPIRED` döner. `Commit` ise kesinleşmiş kilidi tanır
  (`ALREADY_APPLIED`; süresi geçmiş ama bırakılmamış kilidi de alır, `APPLIED`): sipariş `PAID`
  yazılır, istemci başarı alır. Kilit yoksa (`NOT_FOUND`) iptal ve iade. inventory'ye
  ulaşılamazsa hiçbir şey yazılmaz (`SERVICE_UNAVAILABLE`). Yalnız kartla alınmış para için:
  kapıda ödeme "para alınmamış" sayılır, `Commit` yoklanmaz (bekleyen iş 128).
- **Çakışmada para (T15.3, iş 124):** iptal ya da `PAID` yazımı çakıştı ve sipariş başka yolda
  `CANCELLED` olduysa (kullanıcı 3DS onayıyla aynı anda iptal etti ya da süpürücü ödemeyi henüz
  görmeden kapattı), para alınmışsa iade yine yapılır: doğrudan, olmazsa `payment.refund_requested`
  outbox'a. Sabit anahtar ikinci iadeyi önler. Sipariş açık kaldıysa (yalnız sürüm arttı) dokunulmaz;
  karar süpürücünün.
- **Beklenen bitiş (T15.3):** uzatma siparişin bildiği bitişle gider. Kilidin bitişi farklıysa (`moved`)
  güncel bitiş yazılır ve en çok bir tur daha uzatılır; ikinci turda inventory'ye ulaşılamazsa ilk turda
  yazılan güncel bitiş kalır, iki tur da `moved` dönerse WARN. inventory'nin cevabı tam pencere kadar
  ileri değilse (eski sürüm denetimi uygulamamış olabilir) ERROR yazılır; önlem dağıtım sırasıdır (önce inventory).
- **Neden hemen yazılıyor:** 3DS beklenirken (durum değişmez) süpürücü siparişi eski bitişe göre
  kapatmasın. Sürüm arttığı için eski kopyayla yazan süpürücü `CONFLICT` alır ve dokunmaz. Olay
  sürümleri artan kalır ama ardışık olmayabilir (uzatmanın olayı yok).
- **3DS penceresi (bulgu):** payment'ta 3DS kodu çekim anından itibaren **tek** 60 sn'lik pencerede
  geçerli, 3 deneme bu pencerenin içinde (T5.2). Roadmap B21 "deneme başına 60 sn" varsayıyordu;
  bugünkü kurgu en kötü durumda 60 sn ister, uzatma bunu karşılar. Bekleyen iş #77.

### Süpürücü (T11.2 PR 2)

Kullanıcıya görünen davranış süpürücüye bağlı değil: kilidi düşmüş taslak `CreateOrder`'da 410
alır, stoku inventory'nin kendi süpürücüsü geri verir. Bu süpürücü **kayıtları ve parayı**
toparlar: kilidi dolmuş `DRAFT` ve `AWAITING_PAYMENT` siparişleri kapatır
(`application/sweep-expired-reservations.ts`, işçi `interfaces/workers/reservation-sweeper.ts`).

- **Sıklık:** `ORDER_SWEEPER_INTERVAL_MS` (varsayılan 10 sn, 1 sn–10 dk), turda en fazla 100
  sipariş, kilidi önce dolan önce. Kilidi olmayan eski (T11.2 öncesi) siparişe dokunmaz.
- **Ödeme bekleyen sipariş:** önce payment-svc'ye sorulur (`GetPayment`,
  `domain/payment-standing.ts`). Para alınmışsa önce `Commit`: stok kesinleşmişse sipariş `PAID`
  olur (iş 124); kilit yoksa `CANCELLED` olur, iade komutu (`payment.refund_requested`) aynı
  yazımda kaydedilir ve doğrudan iade denenir (T15.3; karar `application/lapsed-order.ts`,
  kilidi düşmüş ödemeyle aynı tablo). Kart çekimi sürüyorsa
  (`PENDING`) o tur atlanır. Kapıda ödemenin
  `PENDING`'i "para alındı" sayılmaz: tutar teslimatta alınır.
- **Sıra:** önce sipariş yazılır (sürüm kontrollü), sonra kilit ve iade. Sipariş o arada başka bir
  yazımla değiştiyse dokunulmaz; para alınmış ve siparişi başka yol iptal etmişse iade yine yapılır.
- **Birden fazla örnek:** lider kilidi yok. Sürüm kontrolü ve iadenin sabit anahtarı
  (`refund-<orderId>`) aynı siparişin iki kez kapanmasını ya da iki kez iade edilmesini önler. Redis
  gerekmez; MOCK modunda da çalışır.
- **Hata:** bir siparişin hatası (payment kapalı) turu durdurmaz; sayılır, sonraki turda tekrar
  denenir. Her sipariş kendi istek kimliğiyle kapanır (payment ve inventory günlüğünde tek iz).
- **Metrikler:** `order_sweeper_closed_total{status}` (kapanmadan önceki durum: `DRAFT`,
  `AWAITING_PAYMENT`), `order_sweeper_completed_paid_total` (stoğu kesinleşmiş, parası alınmış
  sipariş `PAID` yazıldı; iş 124) ve `order_sweeper_errors_total` (kapanamayan sipariş, düşen tur); uç
  `localhost:51053/metrics`. Bir şey kapandıysa turda tek özet satırı.
- **Bilinen sınır:** kartla ödemede `Commit` uygulandıktan sonra sipariş `PAID` yazılamadan süreç
  çökerse sipariş artık tamamlanır: tekrar istek ya da süpürücü `Commit`'ten `ALREADY_APPLIED` alır
  ve `PAID` yazar (T15.3, iş 124). Kapıda ödemede bu kurtarma yok: kilidi düşmüş yol (süpürücü ya
  da kalan süresi kısa tekrar) siparişi kapatır, kesinleşmiş stok geri dönmez (bekleyen iş 128).
  Kalan süre yetiyorsa tekrar istek normal yoldan tamamlar. Kullanıcı tam o anda 3DS'i onaylarken iptal ederse sipariş
  kapanır ve para iade edilir ama kesinleşmiş stok geri dönmez: eksik satış yönü, fazla satış yok
  (bekleyen işler #70).

## Kurye ataması (T13.1 PR 2, sıra T13.2 PR 2)

Sipariş `PAID` olunca kurye atanır (roadmap "Bitti sayılır"). Atamanın sahibi courier-svc'dir
(`AssignCourier`, B7: tek atomik `findOneAndUpdate`); order kuryeyi **arka planda bir işçiyle**
ister, ödeme isteği beklemez (`application/dispatch-couriers.ts` tek tur,
`application/assign-courier-step.ts` sipariş başına adım, işçi
`interfaces/workers/courier-dispatcher.ts`, kurallar `domain/courier-dispatch.ts`).

| courier-svc'nin cevabı               | Sipariş                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Kurye atandı                         | `PAID` → `PREPARING`, kurye (`courier.courierId`, `assignedAt`) aynı yazımda; tek olay     |
| Boş kurye yok (`NOT_FOUND`)          | `PAID` → `PREPARING` kuryesiz, `courierRetryAt` = şimdi + 30 sn; bekleyen yeniden yazılmaz |
| Ulaşılamıyor (`SERVICE_UNAVAILABLE`) | Değişmez; tur kesilir, her tur (1 sn) yeniden denenir; D17 devresi açıksa ağa gidilmez     |

- **Sıklık:** 1 sn'de bir tur, turda en fazla 100 talep (yeni `PAID` ya da deneme anı gelmiş
  kuryesiz `PREPARING`) ve onlardan önce ödemiş en fazla 100 bekleyen (`config/constants.ts`,
  ADR-11). Ödenen sipariş en geç ~1 sn sonra `PREPARING` olur; `order.status_changed` aynı
  transaction'da outbox'a yazılır, realtime T12.3 hattıyla iter.
- **Sıra: önce ödeyen önce (#92, T13.2 PR 2).** Sipariş kuyruğa ödeme anıyla girer
  (`courierQueuedAt`, `PAID` geçişinde ödeme adımı yazar; kurye atanınca silinir). Turda talep
  varsa, ondan **önce ödemiş** kuryesiz bekleyenler de aynı turda ve önce denenir; 30 sn'leri
  beklenmez. Böylece boşalan kurye, ona ulaşabilen en eski siparişe gider: bekleyen sipariş, sonra
  ödeyen siparişe kuryeyi kaptırmaz (QA'nın W/N senaryosu, birim ve gerçek Mongo testi). Eski
  bekleyen başka semtteyse `NOT_FOUND` alır, yeni sipariş kendi kuryesini alır: semtler birbirini
  bekletmez. Talep yoksa bekleyenler 30 sn kuralıyla sürer; courier çağrısı yalnızca talep varken
  artar. Sıra kuralı `domain/courier-dispatch.ts` (`courierQueue`); iki okuma
  (`findAwaitingCourier`, `findWaitingBefore`) yalnızca adayları getirir.
- **Bekleyen yeniden yazılmaz, market başına tek soru (QA O2).** Zaten bekleyen sipariş yine kurye
  bulamazsa yazılmaz: durumu ve sürümü aynı kalır. Aynı turda bir market için courier "kurye yok"
  dediyse o marketin sıradaki siparişleri courier'e sorulmaz (aynı market aynı havuz); ödenmiş olan
  kuryesiz `PREPARING`'e geçer. Turda courier çağrısı en çok kurye bulamayan market sayısı kadar
  artar, bekleyen yazımı yoktur. Bedeli: deneme anı yalnızca ilk beklemeyi belirler; geçtikten sonra
  bekleyen her turda (1 sn) denenir, ama market başına tek çağrıyla. Kurye boşalınca o marketin en
  eski bekleyeni en geç ~1 sn içinde alır.
- **Göç 0001 (`kurye-sirasi`):** alan öncesi kuryesiz `PAID` ve bekleyen `PREPARING`'e kuyruk anını
  zaman çizelgesindeki ödeme anından yazar (yoksa oluşturma anı). Açılışta kendiliğinden uygulanır;
  `down` alanı ve kuyruk indeksini kaldırır. Transaction'sız ve yeniden çalıştırılabilir (indeks
  düşürmek transaction'da yapılamaz).
- **Durum dışı güncelleme sürümü artırır:** kuryesiz `PREPARING`'e kurye ya da yeni deneme anı
  yazmak geçiş değildir (zaman çizelgesi ve olay yok) ama sürüm bir artar: iki örnek birbirinin
  yazımını ezmesin (soket `seq`'i boşluklu ilerleyebilir, `docs/api/socket-events.md`).
- **Önce atama, sonra yazım:** courier-svc tekrar güvenlidir (aynı siparişe aynı kurye); order
  yazamadığı ya da cevabını alamadığı atamayı sonraki turda yeniden ister, ikinci kurye bağlanmaz.
- **Telafi (QA T3):** atama uçuştayken sipariş kapanabilir; iptal yolunun `ReleaseCourier`'ı
  atamadan önce varırsa boş döner (`released=false`) ve atama kuryeyi iptal edilmiş siparişe bağlar.
  Bu yüzden yazım sürüm çakışması alınca sipariş yeniden okunur: son durumdaysa (iptal, teslim) ya
  da kayıt yoksa kurye **geri verilir**; hâlâ kurye bekliyorsa atama güncel kayda yeniden yazılır
  (en çok 3 deneme); kuryesi yazılmışsa (başka örnek önce davrandı) dokunulmaz. Çakışma dışı yazım
  hatasında kurye bırakılmaz: yazım olmuş olabilir. Birim ve gerçek Mongo testi
  (`test/integration/courier-dispatch.spec.ts`).
- **Birden fazla örnek:** lider kilidi yok; courier'in tekrar güvenliği ve sürüm kontrolü sipariş
  başına tek kurye ve tek `PREPARING` olayı verir (entegrasyon testi: iki örnek, 10 sipariş).
- **Hatanın kaynağı (D1):** courier çağrısının ve sipariş deposunun hataları ayrı işaretlenir
  (`CourierStepFailure`). Ulaşılamazken her saniye satır yazılmaz: kaynak başına (courier, depo)
  geçiş bir kez WARN, geri geliş bir kez INFO. Depo arızası "courier'e ulaşılamıyor" görünmez;
  kuyruk okunamazsa da tur hata fırlatmaz, geçişte bir WARN. Courier için "geri geldi" ancak
  courier bir siparişe cevap verince yazılır.
- **Geri çekilme (D3):** ulaşılamama dışı bir hata veren sipariş (ör. courier'in reddi) her turda
  denenmez: 1 sn'den başlayıp ikiye katlanan bekleme, en çok 5 dk; WARN yalnızca ilk hatada,
  sonrakiler DEBUG ve metrik. Durum bellekte ve örnek başına: yeniden başlayınca sıfırlanır.
- **Günlük gürültüsü (D2):** "markette boş kurye yok" INFO'su yalnızca `PAID` → kuryesiz
  `PREPARING` geçişinde; bekleyenin sonraki denemeleri DEBUG. Tur özeti yalnızca atama, geri verme
  ya da hata olunca.
- **Metrik:** `order_courier_dispatch_total{outcome}` (`assigned`, `no_courier`, `released`) ve
  `order_courier_dispatch_errors_total{source}` (`courier`, `store`, `order`: beklenmeyen); devre
  `courier` hedefiyle (D17).
- **MOCK:** işçi bellek deposunda da çalışır ve `COURIER_GRPC_ADDR`'e (varsayılan
  `localhost:50056`) gider; courier MOCK'ta kendi bellek kuryeleriyle cevap verir.
- **Bu PR'da yok:** sipariş cevabında kurye (`order.proto`, gateway, contracts) ve `courier.assigned`
  soket olayı T13.4'te; ETA T13.2 PR 3'te. Deneme anı olmayan eski kuryesiz `PREPARING` işçiye girmez.
- **Bilinen sınır (talep sınırı):** bir turda 100'den fazla yeni ödeme gelirse turun hangi 100'ünü
  aldığı kimlik sırasıdır (talep sorgusu T13.1'deki gibi); kalanı sonraki turda (1 sn).
- **Bilinen sınır:** telafinin `ReleaseCourier`'ı da düşerse (courier tam o an kapandı) kurye `BUSY`
  kalır; sipariş son durumda olduğu için işçi onu bir daha görmez. Bugün ödenmiş siparişi iptal eden
  bir yol yok (`PREPARING` → `CANCELLED` geçişi yok); kalıcı telafi komutu iptal yolu gelince.

## Outbox ile olay yayını (T7.3, ADR-04)

"Önce yaz, sonra yayınla" iki adımı arasında çökülürse sipariş vardır ama kimse duymamıştır.
Bu yüzden sipariş ve olayları **tek Mongo transaction'ında** yazılır; ayrı bir işçi
yayınlanmamış olayları sonra `stream:events`'e basar.

| Olay                       | Ne zaman                                           | Payload                                                            |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `order.created`            | Taslak açılınca (B8: kimlik burada doğar)          | `orderId, userId, marketId, status, totalMinor, currency, version` |
| `order.status_changed`     | Her geçişte, **geçiş başına bir olay**             | `orderId, userId, marketId, from, to, note?, version`              |
| `payment.refund_requested` | İade telafisi (T7.1); düşmüş kilit (T15.3)         | `orderId, reason, idempotencyKey`                                  |
| `payment.cancel_requested` | Ödeme aşamasından `CANCELLED`'a geçiş (T11.2 PR 3) | `orderId, reason` (`order_cancelled`)                              |

- **Olay unutulamaz:** `OrderRepository.insert/update` olayları **zorunlu** parametre olarak
  alır (`domain/order-events.ts` türetir). Sipariş yazıldıktan sonra olay yazımı patlarsa
  transaction geri alınır, sipariş de eski halinde kalır (sözleşme testi
  `test/support/order-outbox-contract.ts`, gerçek Mongo'da `test/integration/outbox.spec.ts`).
- **Eş zamanlı yazım (inceleme bulgusu):** başka bir transaction aynı siparişi tutarken yazan
  kaybeden Mongo'dan `WriteConflict` alır. mongo-kit bu "geçici" hatayı sürücüye geri verir,
  sürücü transaction'ı yeniden dener ve kaybeden güncel sürümü görüp `CONFLICT` üretir. Bu
  olmadan `INTERNAL` dönüyor ve saga'nın iade telafisi hiç çalışmıyordu.
- **Zarf (ADR-07):** yayında `@getir/event-bus` zarfına çevrilir: `eventId` (`evt_…`),
  `topic`, `partitionKey` = `orderId`, `occurredAt`, `payload`. `version` realtime'ın soket
  `seq`'i olarak kullanılabilir.
- **İsteğin izi (D16):** olayı yazan isteğin `requestId`'si ve iz bağlamı (`traceparent`, gRPC
  handler'ının sunucu span'i) outbox satırına iki isteğe bağlı alan olarak yazılır (insert, update ve
  telafi komutu `append`; bağlamdan altyapı okur, use-case değişmedi). Yayıncı ikisini zarfa kopyalar
  ve yayını bu bağlamın çocuğu olan bir span'de yapar: `payment.refund_requested`'i işleyen tüketici
  siparişi veren isteğin izinde ve aynı `requestId` ile görünür. İstek dışı yazımda (seed) ve eski
  satırlarda alanlar yoktur; biçimsiz değer atılır, yayın durmaz.
- **Yayıncı** (`interfaces/workers/outbox-publisher.ts` → `application/relay-outbox.ts`): 500 ms'de
  bir tur, turda en fazla 100 olay, yayın sırası `occurredAt`, eşitlikte `version`. İlk hatada tur
  durur (sonraki olay öncekini geçmesin); yalnızca yayınlananlar işaretlenir. Dolu parti çıkarsa
  beklemeden devam eder. Zincirli `setTimeout`: turlar üst üste binmez; kapanışta süren tur
  beklenir, sonra Redis, en son Mongo kapanır.
- **Metrikler (T10.5, #12; `interfaces/workers/outbox-metrics.ts`):** `outbox_events_published_total`
  (hatta yayınlanan), `outbox_relay_errors_total` (yarıda kalan ya da hiç yapılamayan tur) ve
  `outbox_lag_seconds` (turun gördüğü en eski yayınlanmamış olayın yaşı). Sağlıklı yayında gecikme tur
  aralığının (0,5 sn) altında kalır; büyümesi hattın takıldığını gösterir. Uç `localhost:51053/metrics`.
- **En az bir kez teslim:** yayınla–işaretle arasında çökülürse olay tekrar gider; tüketici
  tekrar-güvenli yazılır (`eventId` ya da iş anahtarıyla; payment iadeyi kaydın durumundan tanır).
- **Telafi komutu:** çekim başarılı ama sipariş `PAID` yazılamadıysa önce doğrudan iade denenir;
  o da olmazsa `payment.refund_requested` outbox'a yazılır; payment-svc `payment` tüketici
  grubuyla dinleyip iade eder (T7.4, gövde şeması `@getir/contracts` `events.ts`). Komut tekrar
  gelirse ikinci iade yapılmaz; işlenemezse `stream:events:dead`'e düşer (payment README). Komut
  da yazılamazsa son çare ERROR günlüğü.
- **İndeks:** `outbox` üzerinde `{ publishedAt, occurredAt, version, _id }`; yayıncının
  `{ publishedAt: null }` + sıralı okuması indeksten, bellekte sıralamasız (explain testli).
  Roadmap veri modelindeki "sparse" bilerek yok: `{ publishedAt: null }` sorgusu alanı hiç
  olmayan belgeleri de eşler, planlayıcı sparse indeksi bu sorgu için kullanmaz.
- **Bilinen sınır:** tek order örneği varsayılır. İki örnek aynı olayı aynı anda yayınlayabilir;
  en az bir kez teslim ve `eventId` tekilleştirmesi bunu zararsız kılar (kiralama/lider seçimi
  gerekirse T10.3'ün `lock:reconcile` kalıbı). Yayınlanmış satırların budanması ADR-04'teki
  kabul edilen borçtur.

## Katmanlar

```text
src/
├── domain/            # saf iş kuralı — mongodb/grpc/proto importu YOK
│   ├── order.ts                 # Order, createDraftOrder, transitionOrder (timeline + version)
│   ├── order-item.ts            # dondurulmuş kalem (OrderItem) ve tutar (OrderPricing)
│   ├── price-draft.ts           # saf fiyat kuralı: priceDraft, assertExpectedTotal (T7.2)
│   ├── order-state-machine.ts   # geçiş tablosu, USER_CANCELLABLE
│   ├── order-repository.ts      # port: insert / update(sürümlü, olaylarla) / findById + hataları
│   ├── order-events.ts          # olay türetme: created, status_changed, refund_requested (T7.3)
│   ├── order-outbox.ts          # port: append / pending / markPublished (T7.3)
│   ├── order-history-reader.ts  # port: listByUser, hasPaidOrder (ILK10), riskHistory (T7.1)
│   ├── checkout-risk.ts         # saga risk adımı: bant → karar/politika, risk bağlamı (T7.1)
│   ├── checkout-payment.ts      # saga ödeme adımı: ödeme sonucu → sipariş, anahtarlar (T7.1)
│   ├── stock-reservation.ts     # stok kilidi kuralları: bırakma gerekçeleri, sistem iptalleri (T11.2), banda göre kilit ve uzatma kararı (T11.3)
│   ├── payment-standing.ts      # para alındı mı, çekim sürüyor mu (T11.2 PR 2); REQUEST_IN_PROGRESS cevabı
│   ├── expired-order-finder.ts  # port: kilidi dolmuş siparişler, süpürücünün kuyruğu (T11.2 PR 2)
│   ├── courier-dispatch.ts      # kurye bekleyen sipariş, kuryeyle/kuryesiz PREPARING, telafi kararı (T13.1), kuyruk sırası (#92)
│   ├── awaiting-courier-finder.ts  # port: kurye bekleyen siparişler, kurye işçisinin kuyruğu (T13.1)
│   ├── order-history-listing.ts # Geçmiş Siparişlerim'de görünürlük kuralı (#101)
│   └── order-history-cursor.ts  # geçmiş sırası ve imleç
├── application/       # bir dosya = bir use-case
│   ├── create-draft-order.ts, create-order.ts, confirm-payment.ts, cancel-order.ts
│   ├── get-order.ts, list-my-orders.ts
│   ├── risk-step.ts, payment-step.ts  # saga adımları (T7.1), use-case'ler paylaşır
│   ├── draft-reservation.ts     # taslağın stok kilidi: kilitle / yetmedi / sepeti yenile (T11.2), yetim kilit (T15.3)
│   ├── stock-step.ts            # saga'nın kesinleştirme ve en iyi gayretle bırakma adımı (T11.2)
│   ├── lock-timing.ts           # kilidin süresi: orta bantta kısaltma, ödeme öncesi uzatma, düşmüş kilit (T11.3)
│   ├── lapsed-order.ts          # kilidi düşmüş siparişi kapatma tablosu: saga ve süpürücü (T15.3)
│   ├── order-transition.ts      # sürüm kontrollü geçiş yazımı ve PAID (payment-step, lapsed-order)
│   ├── refund-step.ts           # telafi iadesi: doğrudan, olmazsa outbox komutu (T7.1, T7.3)
│   ├── sweep-expired-reservations.ts  # süpürücünün tek turu (T11.2 PR 2)
│   ├── dispatch-couriers.ts     # kurye işçisinin tek turu (T13.1 PR 2; kuyruk, kaynak, geri çekilme T13.2)
│   ├── failure-backoff.ts       # atanamayan siparişin geri çekilmesi (D3, T13.2)
│   ├── assign-courier-step.ts   # sipariş başına kurye adımı: ata, yaz, gerekirse geri ver (T13.1)
│   ├── relay-outbox.ts          # tek yayın turu: bekleyenler → hat → işaret (T7.3)
│   ├── own-order.ts             # "kendi siparişi değilse NOT_FOUND" tek yerde
│   ├── catalog-pricing.ts       # port: marketRules, activeOffers (T7.2)
│   ├── risk-assessment.ts       # port: evaluate (T7.1)
│   ├── payments.ts              # port: charge, confirmThreeDs, refund (T7.1), getPayment (T11.2 PR 2)
│   ├── stock-reservations.ts    # port: reserve, commit, release (T11.2), extend, shorten (T11.3)
│   ├── courier-assignment.ts    # port: assign, release (T13.1)
│   └── request-scope.ts         # use-case'e taşınan requestId + çağrının logger'ı
├── infrastructure/
│   ├── order-store.ts           # MOCK ya da Mongo: depoyu açar, kapanışı verir
│   ├── grpc-resilience.ts       # istemcilerin devre kesicisi ve yeniden deneme politikası (D17)
│   ├── catalog/                 # order -> catalog gRPC istemcisi (service-kit callUnary)
│   ├── risk/, payment/          # order -> risk / payment gRPC istemcileri (T7.1)
│   ├── inventory/               # order -> inventory gRPC istemcisi (T11.2)
│   ├── courier/                 # order -> courier gRPC istemcisi (T13.1)
│   ├── memory/                  # MOCK: bellek deposu
│   ├── fixtures/persona-orders.ts  # demo personalarının sipariş geçmişi (T8.1)
│   └── mongo/                   # belge şekli, çeviriciler, sorgular (orders, outbox), portlar
├── interfaces/grpc/   # ince handler'lar: doğrula → çağır → çevir
│   ├── schemas.ts     # Zod istek şemaları (sayfa boyutu kırpma, jeton çözme)
│   ├── page-token.ts  # imleç ↔ opak sayfa jetonu
│   ├── mappers.ts     # domain → proto (durum, Order)
│   ├── orphan-lock-metrics.ts  # bırakılan yetim kilit sayacı (T15.3)
│   └── order-handlers.ts
├── interfaces/workers/outbox-publisher.ts  # zamanlayıcı: turu aralıkla çalıştırır, kapanışta bekler
├── interfaces/workers/outbox-metrics.ts    # yayın, hata ve gecikme metrikleri (T10.5)
├── interfaces/workers/reservation-sweeper.ts  # süpürücü zamanlayıcısı (T11.2 PR 2)
├── interfaces/workers/sweeper-metrics.ts   # kapanan ve kapanamayan sipariş metrikleri
├── interfaces/workers/courier-dispatcher.ts  # kurye işçisi zamanlayıcısı (T13.1 PR 2)
├── interfaces/workers/dispatcher-metrics.ts   # kurye işçisinin sonuç ve hata metrikleri (kaynak etiketi T13.2)
├── migrations/        # göçler (ADR-19): 0001-kurye-sirasi (kurye kuyruğu anı, T13.2), 0002-gecmis-gorunurlugu (#101)
├── config/            # env.ts (process.env yalnızca burada) + constants.ts
├── bootstrap.ts
├── main.ts
└── healthcheck.ts
```

Zaman `Clock` soyutlaması üzerinden okunur — `Date.now()` iş mantığında çağrılmaz, böylece
testte saat sabitlenebilir.

## Demo personalarının sipariş geçmişi (T8.1)

risk-svc'nin `order-history` ve `basket-anomaly` kuralları bu servisin siparişlerinden beslenir
(`riskHistory`: teslim ve iptal sayısı, ortalama sepet). Personaların hesapları gateway'dedir;
geçmişleri burada (`infrastructure/fixtures/persona-orders.ts`), aynı kullanıcı kimlikleriyle:

| Persona | Teslim | İptal | Ortalama sepet |
| ------- | ------ | ----- | -------------- |
| Ayşe    | 5      | 0     | 200 TL         |
| Zeynep  | 0      | 0     | —              |
| Can     | 1      | 3     | 120 TL         |
| Ali     | 3      | 1     | 180 TL         |
| Komşu   | 12     | 1     | 280 TL         |

Siparişler hazır "Ev" adresine, geçmiş tarihlidir; kimlikleri persona ve sıradan türetilir
(tekrar yazımda kopya olmaz). Olay YAZILMAZ: geçmiş sipariş bugün olmuş gibi yayınlanmaz.
İptaller ödeme öncesi kullanıcı iptalidir (`USER_CANCELLED`): risk geçmişinde sayılır, Geçmiş
Siparişlerim'de görünmez (#101); listede yalnızca teslim edilenler durur.

- `MOCK=true`: servis açılırken belleğe yüklenir (production dışında).
- Mongo: `pnpm --filter @getir/order-service seed:personas` personaların eski siparişlerini
  silip tek transaction'da yeniden yazar; `NODE_ENV=production` iken reddeder. Kökteki
  `pnpm seed:personas` bunu gateway'in hesap seed'iyle birlikte çalıştırır.

## Çalıştırma ve doğrulama

```bash
pnpm --filter @getir/order-service build
MOCK=true pnpm --filter @getir/order-service start    # 50053, Mongo'suz (bellek)

pnpm infra:up                                         # ya da Mongo + Redis ile:
MOCK=false pnpm --filter @getir/order-service start   # adresler kok .env'de (ORDER_MONGO_URI, REDIS_URL)

# Yayınlanan olaylar (T7.3): taslak aç / sipariş ver, sonra
docker exec getir-redis redis-cli XRANGE stream:events - +
```

```bash
# 1) Taslak aç → orderId
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"user_id":"usr_1","market_id":"mkt_migros-jet-moda",
       "lines":[{"product_id":"prd_bulasik-deterjan","sku":"BULASIK-DETERJAN","quantity":2},
                {"product_id":"prd_cikolata-80","sku":"CIKOLATA-80","quantity":1}],
       "delivery_location":{"lat":40.99,"lng":29.02},
       "delivery_address":"Kadıköy","idempotency_key":"4f1c3a2b-9d8e",
       "expected_total":{"amount_minor":19360,"currency":"TRY"}}' \
  localhost:50053 getir.order.v1.OrderService/CreateDraftOrder
# seed fiyatlarıyla: 2 x 67,90 + 32,90 = 168,70 + 24,90 teslimat = 193,60 TL.
# Farklı toplam gönderirsen ABORTED + PRICE_CHANGED (ayrıntıda doğru toplam).
# catalog-service (50051) ayakta olmalı: fiyatlar oradan okunur.

# 2) Siparişe çevir (saga): risk-service (50055) ve payment-service (50054) ayakta olmalı.
#    Test kartları: tok_test_4242 onay, tok_test_0002 red, tok_test_3184 3DS.
#    Taslaktan hemen sonra (3 sn içinde) gönderirsen yeni kullanıcı MEDIUM bant alır
#    (teslimat yok 15 + bot hızı 15 = 30): 4242 bile 3DS ister, cevapta challenge_id döner.
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<1. adımdan>","user_id":"usr_1","payment_method":"PAYMENT_METHOD_CARD",
       "card_token":"tok_test_4242","idempotency_key":"4f1c3a2b-9d8e",
       "details":{"note":"","do_not_ring_bell":false,"agreements_accepted":true}}' \
  localhost:50053 getir.order.v1.OrderService/CreateOrder
#    details zorunlu (T12.4). Kayıtlı kartla: card_token yerine "card_id":"crd_..." (kart kasası).

# 2b) 3DS istendiyse onayla → PAID (mock kod 123456; yanlış kod THREEDS_FAILED + kalan hak)
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<1. adımdan>","user_id":"usr_1","challenge_id":"<2. adımdan>",
       "code":"123456","idempotency_key":"7e6d5c4b-3a2f"}' \
  localhost:50053 getir.order.v1.OrderService/ConfirmPayment

# 2c) Kurye (T13.1): courier-service (50056) ayaktaysa PAID sipariş ~1 sn içinde PREPARING olur
#     (GetOrder ile bak); markette boş kurye yoksa kuryesiz PREPARING, 30 sn sonra yeniden.

# 3) Geçmiş → en yeni sipariş başta; yalnızca ödenmiş, incelemedeki ve ödendikten sonra iptal
#    edilenler (#101): 1. adımın taslağı ödenene kadar listede yok.
#    Mongo modunda Compass'ta getir.orders altında da görünür (inHistory alanıyla).

grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"user_id":"usr_1","page":{"page_size":10}}' \
  localhost:50053 getir.order.v1.OrderService/ListMyOrders

# 4) İptal → CANCELLED: yalnızca DRAFT / RESERVED / AWAITING_PAYMENT (B29); 2. adımda PAID
#    olan sipariş ORDER_STATE_INVALID alır, bu yüzden yeni bir taslakla dene.
#    Anahtarsız istek INVALID_ARGUMENT.
grpcurl -plaintext -import-path packages/proto/proto -proto getir/order/v1/order.proto \
  -d '{"order_id":"<yeni taslak>","user_id":"usr_1","reason":"CHANGED_MIND","idempotency_key":"9a8b7c6d-5e4f"}' \
  localhost:50053 getir.order.v1.OrderService/CancelOrder
```

Aynı akışın otomatik karşılığı `test/unit/grpc/*.spec.ts` (bellek, RPC başına bir dosya),
`test/integration/mongo-order-store.spec.ts` (gerçek Mongo: sözleşme, indeks planı, gRPC →
`orders` belgesi) ve `test/integration/courier-dispatch.spec.ts` (kurye işçisi gerçek Mongo'da).

## Docker

```bash
docker build -f apps/order-service/Dockerfile -t getir/order-service .
docker run --rm -p 50053:50053 -e MOCK=true getir/order-service
node scripts/check-node-image.mjs getir/order-service   # imaj denetimi (D12), CI'da da kosar
```

Çok aşamalı imaj, `node` kullanıcısı, `grpc.health.v1` ile `HEALTHCHECK`. Ayrıntılı gerekçe
catalog-service README'sinde; iki Dockerfile bilinçli olarak birbirinin eşidir.

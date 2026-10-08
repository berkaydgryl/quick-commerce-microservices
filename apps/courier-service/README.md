# @getir/courier-service

Kurye servisi: `couriers` koleksiyonunun **tek sahibi** (ADR-05). Siparişe kurye atar ve bırakır.
Siparişin durumunu değiştirmez; atamayı order ister, sonucu kendi belgesine yazar ve `PREPARING`'e
geçer (T13.1 PR 2). Canlı konum akışı bu servisin RPC'lerinden geçmez (`courier.proto` başı);
aşama 1'de web siparişin takibini `GetTracking` ile gateway üzerinden yoklar (T13.3).

**Kurye havuzu (T13.2):** kurye bir markete bağlı değildir. Siparişin marketinin **3 km**
çevresindeki boş kuryelerden biri atanır; demo verisinde Kadıköy ve Beşiktaş iki ayrı havuzdur
(iki semtin en yakın marketleri 4,9 km ayrı; semt içinde en uzak çift 2,6 km). Teslimattan sonra kurye olduğu yerde boşa çıkar, markete dönmez.

## Bugünkü durum (T13.3 aşama 1 — kurye hareketi ve takip)

| Parça                     | Durum                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `couriers` şeması         | ✅ `infrastructure/mongo/documents.ts` (konum GeoJSON), indeksler `couriers-collection.ts`  |
| Havuz ataması (B7)        | ✅ `application/assign-courier.ts` + `nearest-available.ts`, kural `domain/courier-pool.ts` |
| Market konumu kopyası     | ✅ `markets` koleksiyonu (seed ve göç 0001 yazar), MOCK'ta bellek                           |
| Okuma, bırakma            | ✅ `GetCourier`, `ReleaseCourier` (kurye olduğu yerde boşa çıkar)                           |
| Demo kuryeleri            | ✅ `pnpm seed`: her marketin 40-150 m yakınına 3 kurye, 99 (Kadıköy 48, Beşiktaş 51)        |
| Rota ve ETA, `StartRoute` | ✅ atamada kurye -> market -> adres, 20-40 eşit aralıklı nokta; `routes` (T13.2 PR 3)       |
| Hareket, kilometre taşı   | ✅ tick (tek lider), `courier.picked_up` / `courier.delivered`, teslimde kurye `IDLE`       |
| Takip, `GetTracking`      | ✅ zamandan konum, kalan yol ve ETA; paket alınmadan konum yok (gizlilik)                   |
| Konum yayını, iz          | ⏳ T13.3 aşama 2 (`courier.location`, iz tamponu, soket)                                    |

## RPC'ler

| RPC              | Ne yapar                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `AssignCourier`  | Marketin çevresindeki boş kuryeyi bağlar, rotasını üretir, ETA döner; yoksa `NOT_FOUND`         |
| `GetCourier`     | Kuryenin durumu ve son bilinen konumu; yoksa `NOT_FOUND`                                        |
| `ReleaseCourier` | Siparişi taşıyan kuryeyi yerinde `IDLE` yapar; taşıyan yoksa hata değil `released=false`        |
| `StartRoute`     | Atamanın rotasını döner (`already_started = true`); bu kuryeyle rotası yoksa `NOT_FOUND`        |
| `GetTracking`    | Siparişin takibi: aşama, konum, kalan yol, ETA, rota; rota yoksa ya da bırakıldıysa `NOT_FOUND` |

Girdi sözleşme biçimiyle denetlenir: sipariş `ord_<32 hex>`, market `mkt_…`, kurye `crr_<32 hex>`,
teslimat konumu zorunlu. Kullanımdan kalkan `dark_store_id` okunmaz (ADR-15). Cevaptaki kuryenin
`market_id` alanı artık doldurulmaz (havuz); alan sözleşmeden silinmez.

## Atama kuralı: havuz (T13.2, B7)

- **Havuz:** siparişin marketinin konumu servisin kendi kopyasından (`markets`) okunur; o noktanın
  **3 km** (`COURIER_POOL_RADIUS_METERS`) içindeki `IDLE` kuryeler havuzdur. `BUSY` ve `OFFLINE`
  girmez. Market kopyada yoksa `NOT_FOUND` (`reason: market_unknown`) ve WARN; order 30 sn sonra
  yeniden dener, döngüye girmez.
- **Sıra (#88):** önce **300 m'lik yakınlık dilimi** (`floor(mesafe / 300)`), dilim içinde **en uzun
  süredir boşta** olan (`idleSince`), eşitlikte kimlik. Neden dilim: tam mesafe eşitliği nadir; salt
  "en yakın" kuralı birbirine yakın kuryelerden hep aynı birine iş verirdi. Dilim içinde bekleme
  süresi adaleti sağlar, uzaktaki kurye yakındakinin önüne geçmez.
- **Atomik (B7):** `$geoNear` (2dsphere indeksi) sıraya göre en fazla 5 aday okur; adaylar sırayla
  **koşullu** alınır: `findOneAndUpdate({ _id, status: IDLE }, BUSY + currentOrderId + lastAssignedAt,
idleSince silinir)`. Aday o arada başka siparişe gittiyse koşul tutmaz, sıradakine geçilir; kaybedilen
  adaylar sonraki okumada dışlanır (`_id: { $nin }`) ve liste boşalana kadar denenir (üst sınır havuz
  büyüklüğü). `NOT_FOUND` yalnızca "havuzda boş kurye kalmadı" demektir, bellekte ve Mongo'da aynı.
  İki sipariş aynı kuryeyi alamaz (entegrasyon testi: tek kurye, 20 eşzamanlı sipariş → 1 atama;
  5 kurye, 30 sipariş → 5 farklı atama; 30 kurye aynı noktada, 20 sipariş → 20 farklı atama). B7'deki
  hata "oku, sonra körlemesine yaz"dı; burada yazım "hâlâ boşsa" koşullu.
- **Tekrar güvenli:** sipariş zaten bir kuryedeyse aynısı döner. `currentOrderId` üzerindeki kısmi
  benzersiz indeks, aynı sipariş için eşzamanlı ikinci isteği durdurur; kaybeden kazananın kuryesini
  okur (test: aynı sipariş 10 kez eşzamanlı → tek kurye).
- **Rota (T13.2):** atama, kuryenin o anki konumundan markete (paket alma), oradan teslimat adresine
  iki parçalı rotayı üretir ve **bir kez** saklar (`routes`, `_id = siparis`). Nokta sayısı
  `ceil(toplam m / 100)`, 20 ile 40 arasına kırpılır; parçalar iki bacağa uzunluk oranında bölünür
  (kurye marketteyse ilk bacak yok). Noktalar büyük daire üzerinde, **her bacakta eşit aralıklı**
  (slerp, `domain/geo.ts`); iki bacağın aralığı yakın ama eşit olmayabilir (kurye marketten 1 cm
  uzaktaysa ilk parça 1 cm). Simülasyon (T13.3) nokta başına değil mesafe ya da zamanla ilerler.
  Market noktası birebir rotanın köşesi. Kural `domain/route-planner.ts`. Rota uçları birbirine
  antipot olamaz (slerp orada tanımsız): havuz 3 km, adres markete yakın.
- **ETA:** `ceil(distance_meters / (COURIER_SPEED_KMH / 3,6))` saniye, tam sayı; tek kaynak
  yuvarlanmış mesafe (istemci ikisinden aynı sonucu bulur). Atama cevabındaki `eta_seconds` budur. Tekrar istek saklanan rotayı döner: aynı noktalar, aynı ETA (kurye o arada
  yer değiştirse de). Market kopyada yoksa rota üretilemez: atama yine döner, ETA 0 ve WARN.
- **`StartRoute` (karar K a):** rota atamada başlar (kurye hemen markete yürür); `StartRoute` aynı
  rotayı `already_started = true` ve `started_at` = atama anıyla döner, yeni rota üretmez. Kurye
  `BUSY` değilse ya da siparişi taşımıyorsa (bıraktıysa) `NOT_FOUND`; rota belgesi geçmiş olarak
  kalır. Order `StartRoute`'u çağırmaz; `ON_THE_WAY` ve `DELIVERED` geçişleri bu servisin
  `courier.picked_up` ve `courier.delivered` olaylarıyla olur (T13.3, order T14.3).
- **Yeniden atama:** sipariş bırakılıp başka kuryeye ya da aynı kuryeye yeniden atanırsa (bugün
  akışta yok) rota yenisiyle değiştirilir: saklanan rota kuryenin son atamasından eskiyse o atamanın
  değildir.
- **Bırakma:** kurye olduğu yerde `IDLE` olur, `idleSince` bırakma anı; `lastAssignedAt` geçmiş
  bilgisi olarak kalır. Konum Mongo'da yalnızca durum değişiminde yazılır: teslimatta kurye
  **teslimat adresinde** boşa çıkar (T13.3). Yolda iptalde (`ReleaseCourier`) kuryenin ilerleyen
  rotası hemen `ENDED` yazılır (karar M6 a); kurye bugün atandığı yerde kalır, yoldaki anlık
  konumda bırakma bekleyen iş #174.

## Hareket ve takip (T13.3, aşama 1)

- **Zamandan konum:** konum her tick'te Mongo'ya yazılmaz; rotanın üretildiği andan geçen süreden
  her an yeniden hesaplanır (`domain/route-progress.ts`). 1. bacak kurye → market, kurye
  hazırlık bitmeden varırsa markette bekler (`ORDER_PREP_SECONDS`), 2. bacak market → adres.
  Alma anı `max(1. bacak / hız, hazırlık)`, varış anı `alma + 2. bacak / hız`. Tick alma anını
  kaydettiyse alma anı **o kayıttır** ve 2. bacak ondan başlar (#195): hız ayarı yol ortasında
  değişse de 2. bacak sıfır saniye sürmez, kayıtlı almadan sonra aşama `TO_MARKET`'a dönmez (saat
  kaydın gerisindeyse hesap `TO_MARKET` der, gösterim aşamayı kayıttan alır). İlerleme nokta
  başına değil **mesafeyle** (QA B3); sınırlar milisaniyede.
- **Tick (`interfaces/workers/route-ticker.ts`, karar M5 a):** her `COURIER_TICK_MS`'de lider
  kilidi alınır ya da yenilenir (`lock:courier-tick`, `lua/leader.lua` = inventory'nin kopyası,
  ADR-01 kapsam notu). Süreler tek yerden (`config/tick-timing.ts`): kilit ömrü
  `max(tick × 5, 10 sn)`, turun süre bütçesi ömrün yarısı (dolunca kalan rotalar sonraki turda,
  WARN), canlı konum ömrü `max(30 sn, tick × 3)`. Yalnızca lider, bitmemiş rotaları eskiden
  yeniye (en çok 200, `state_createdAt_id` indeksi) okur, kuryelerini **tek toplu okumayla** alır
  ve her rotayı bu ana getirir (`application/advance-route.ts`):
  1. kurye siparişi artık taşımıyorsa (iptal) rota `ENDED`: ilerlemez, olay yok (karar M6 a);
  2. alma anı geldiyse `pickedUpAt` **bir kez** yazılır, `courier.picked_up` yayınlanır, sonra
     `pickupPublished`;
  3. varış anı geldiyse `deliveredAt` yazılır, kurye adreste `IDLE` olur (yalnızca siparişi hâlâ
     **bu kurye** taşıyorsa), `courier.delivered` yayınlanır, rota `DONE`. Teslim anı kayıtlı alma
     anından önce yazılmaz (#190, `deliveredNoEarlierThan`). #195'ten beri 2. bacak kayıtlı
     almadan hesaplandığı için bu kıstırma yalnızca savunmadır (hesap teslimi almadan önce
     koyamaz);
  4. aksi halde canlı konum `courier:{id}:last`'a yazılır (okuyan aşama 2). Yazım hatası günlüğe
     konum taşımaz (ioredis hatası komut argümanlarını taşır; argümansız hataya çevrilir).

  Her yazım koşulludur (`_id`, kurye, atama anı, bitmemiş): yeniden atama ya da başka ölçek
  araya girerse tur bırakılır. İşaret yayından **sonra** yazılır: yayın düşerse sonraki tur
  yeniden yayınlar (en az bir kez). Olay kimliği **belirlenimcidir** (sipariş, rota anı, konu):
  yeniden yayın aynı `eventId`'yi taşır, tüketici tekilleştirir (ADR-04). Olayın anı kilometre
  taşının anıdır. Bilinen sınırlar: hep hata veren rota partinin başında kalır (#171); tick/kilit
  döngüsü inventory'nin kopyası (#172).

- **`GetTracking` (`application/get-tracking.ts`):** değerler çağrı anında aynı fonksiyondan
  hesaplanır; aşama tek yönlüdür (yazılmış kilometre taşı aşamayı geri götürmez). **Gizlilik:**
  kurye önceki müşterinin kapısında boşa çıkar ve oradan atanır; bu yüzden paket alınmadan
  (`TO_MARKET`) konum **verilmez**, kalan yol yalnızca market → adres bacağıdır, ETA dakikaya
  yukarı yuvarlanır ve rota yalnızca market → adres parçasıdır (`@getir/contracts`
  `enforceTrackingPhase` ile aynı kural; test her anı o şemadan geçirir). Kayıtlı alma anı hesabın
  ilerisindeyse (hız ayarı değişti) konum market, ETA yine yuvarlı. `DELIVERED`'da iki an da her
  zaman vardır ve alma ≤ teslim (#190): teslim kayıtlı ?? hesap, alma kayıtlı ?? (teslim hesaptansa)
  hesap ?? teslim; karışık kaynakta (kayıtlı alma + yeni ayarla hesaplanan teslim) teslim almaya
  kıstırılır; kalan yol ve ETA 0. Bilinen sınır: alma anı
  (`pickedUpAt`) gösterildiği için kurye → market süresi, dolayısıyla yönsüz bir uzaklık
  çıkarılabilir; sözleşme bunu kabul eder. Sahiplik (sipariş kimin) gateway'dedir. Koordinatlar
  kişisel veridir: günlüğe yazılmaz.
- **MOCK:** Redis yok: tek örnek hep lider, olaylar şemadan geçer ama yayınlanmaz, canlı konum
  bellekte.

## `couriers`, `markets` ve `routes` belgeleri

`couriers`: `_id (crr_…)`, `name`, `status` (`IDLE | BUSY | OFFLINE`), `currentOrderId?`,
`lastAssignedAt?`, `idleSince?` (yalnızca `IDLE`), `lastLocation` (GeoJSON `Point`, `[boylam, enlem]`),
`lastLocationAt`. Canlı konum her tick'te Redis'e gider ve Mongo'ya yazılmaz (T13.3, T14.1).

İndeksler: `lastLocation_2dsphere_status` (havuz sorgusu, `$geoNear`) ve `currentOrderId_unique`
(kısmi: yalnızca alanı olan belgeler).

`markets`: `_id (mkt_…)`, `location` (GeoJSON). Market kaydının sahibi catalog'dur; burası havuzun
merkezi için **kopyadır**. Seed ve göç 0001 yazar; katalogun demo verisiyle eşitliği testli
(`test/unit/courier-fixtures.spec.ts`). Kopya katalogla eşlenmez (bekleyen iş #93: olayla ya da açılışta
okuyarak): katalogda yeni market courier'de `market_unknown` olur; courier seed'i ya da göç gerekir.

**Göç 0001 (`kurye-havuzu`):** T13.1 biçimindeki kuryeleri çevirir (konum GeoJSON, `marketId` silinir,
`IDLE`'a `idleSince`: son atama ya da seed anı), eski `marketId_status_lastAssignedAt` indeksini düşürür
ve 21 marketin konumunu yazar. Açılışta kendiliğinden uygulanır; `down` geri alır (`marketId` en yakın
marketten). Transaction'sız ve yeniden çalıştırılabilir (indeks düşürmek transaction'da yapılamaz).

`routes` (T13.2): `_id (ord_…)`, `courierId`, `points` (`{lat, lng}` dizisi, 20-40), `pickupIndex`
(market noktasının sırası), `distanceMeters`, `etaSeconds`, `createdAt` (atama anı). T13.3 alanları
(hepsi isteğe bağlı): `marketId`, `state` (`MOVING | DONE | ENDED`), `pickedUpAt`, `pickupPublished`,
`deliveredAt`, `deliveryPublished`, `endedAt`. `state` alanı olmayan eski rota `MOVING` sayılır
(sorgu `state: { $nin: [DONE, ENDED] }`), göç gerekmez. İndeks: `state_createdAt_id` (tick).

Kuryenin adı istemcide görünür, **günlüğe yazılmaz**; günlükte kimlik yeter.

## Çalıştırma

```bash
pnpm --filter @getir/courier-service build
MOCK=true pnpm --filter @getir/courier-service start   # :50056, demo kuryeleri bellekte
pnpm --filter @getir/courier-service seed              # 99 kurye + 33 market konumu (tekrar koşmak sıfırlar)
pnpm --filter @getir/courier-service migrate status

grpcurl -plaintext -import-path packages/proto/proto -proto getir/courier/v1/courier.proto \
  -d '{"order_id":"ord_0123456789abcdef0123456789abcdef","market_id":"mkt_migros-jet-moda","delivery_location":{"lat":40.99,"lng":29.03}}' \
  localhost:50056 getir.courier.v1.CourierService/AssignCourier
grpcurl -plaintext -import-path packages/proto/proto -proto getir/courier/v1/courier.proto \
  -d '{"order_id":"ord_0123456789abcdef0123456789abcdef"}' \
  localhost:50056 getir.courier.v1.CourierService/GetTracking
```

Metrikler `:51056/metrics` (gRPC portu + 1000).

## Ortam

| Değişken             | Varsayılan      | Not                                                           |
| -------------------- | --------------- | ------------------------------------------------------------- |
| `COURIER_GRPC_PORT`  | `50056`         |                                                               |
| `COURIER_MONGO_URI`  | —               | `MOCK=false` iken zorunlu; kendi kullanıcısı (D14)            |
| `COURIER_MONGO_DB`   | `getir_courier` |                                                               |
| `MOCK`               | `false`         | `true`: demo kuryeleri ve marketler bellekte, Mongo/Redis yok |
| `COURIER_SPEED_KMH`  | `20`            | Kurye hızı (km/sa, tam sayı 1-120): rotanın ETA'sı            |
| `COURIER_TICK_MS`    | `2000`          | Tick aralığı (ms, 200-60000)                                  |
| `ORDER_PREP_SECONDS` | `300`           | Markette hazırlık (sn, 0-3600); demo `.env.example` 30        |
| `REDIS_URL`          | —               | `MOCK=false` iken zorunlu: tick kilidi, olaylar, canlı konum  |

**Yerel Mongo'da kullanıcı:** `infra/docker/mongo/init/service-users.js` kullanıcıları yalnızca **boş
hacimde** oluşturur. Daha önce kurulmuş bir `getir-mongo`'da `courier` kullanıcısı kendiliğinden
oluşmaz: `.env`'e `COURIER_MONGO_URI` ve `COURIER_MONGO_DB` eklenir, kullanıcı bir kez
`pnpm infra:mongosh` ile oluşturulur (`readWrite` → `getir_courier`) ya da hacim sıfırlanır
(`pnpm infra:reset`, veri gider).

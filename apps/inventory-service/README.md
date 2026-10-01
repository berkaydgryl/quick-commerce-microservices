# @getir/inventory-service

Stok gerçeğinin **tek sahibi** (ADR-03, ADR-05): market × SKU için eldeki adet. Başka hiçbir
servis `stock` koleksiyonuna ya da `stock:{market}:avail:{sku}` sayaçlarına dokunmaz; stok
yalnızca `getir.inventory.v1.InventoryService` RPC'leri üzerinden okunur ve (T10'dan sonra)
hareket eder.

Bu serviste **olmayanlar**, bilinçli: ürün adı, fiyatı ve kategorisi `catalog-service`'in;
sipariş durumu ve rezervasyon süresinin **ne kadar** olacağı `order-service`'in işidir.

## Bugünkü durum (T9.1 + T9.2 + T10.1 + T10.2 + T10.3)

| RPC                 | Durum                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CheckAvailability` | ✅ Toplu (en fazla 100 SKU, B27): satılabilir adetler + `unknown_skus` (bu markette kaydı olmayan ya da biçimsiz) |
| `Reserve`           | ✅ Sepetin tamamı tek atomik adımda ya da hiç (`reserve.lua`, T10.1); aşağıda                                     |
| `Release`           | ✅ Rezervasyonu bırakır, adetler sayaca döner; stok defterine yazar (`release.lua`, T10.2 PR 1); aşağıda          |
| `Commit`            | ✅ Onay: eldeki adet kalıcı düşer, defterde −adet (`commit.lua` + tek Mongo transaction'ı, T10.2 PR 2); aşağıda   |
| `ExtendReservation` | ⏳ `NOT_IMPLEMENTED` — T11.3                                                                                      |
| `GetReservation`    | ⏳ `NOT_IMPLEMENTED` — T10                                                                                        |

## Stok nerede durur (ADR-03)

| Depo  | Anahtar / koleksiyon                   | İş                                                                  |
| ----- | -------------------------------------- | ------------------------------------------------------------------- |
| Mongo | `stock` (`marketId`+`sku` benzersiz)   | Kalıcı gerçek: eldeki adet, `version` (iyimser kilit, T10.2)        |
| Mongo | `stock_ledger` (T10.2, ADR-18)         | Her stok hareketinin değişmez kaydı; toplamı eldeki adede eşittir   |
| Redis | `stock:{market}:avail:{sku}` (TTL'siz) | Sıcak yolun karar mercii; `CheckAvailability` yalnızca buradan okur |

- **Toplu okuma:** bir marketin bütün sayaçları aynı hash-tag'dedir (`{market}`); istek tek `MGET`.
- **Bilinmeyen SKU** hata değildir, `unknown_skus`'a düşer: "bu markette satılmıyor" ile "tükendi" (0)
  ayrımı buradan çıkar. Biçimi bozuk SKU da oraya düşer; tek hatalı kalem bütün listeyi düşürmez.
  **Bilinmeyen market** da hata değildir: marketin varlığı kataloğun işidir, SKU'lar `unknown_skus`'tadır.
- **Negatif sayaç** (fazla satış izi) 0 döner ve uyarı yazılır; tam sayı olmayan sayaç `INTERNAL`.
- **Sayaçlar TTL'sizdir** (ADR-03; proje kurallarındaki Redis TTL istisnası): süresi dolan bir önbellek
  değil, stok kararının kendisidir.

## Rezervasyon (T10.1)

`Reserve` sepetin **tamamını** tek bir Redis Lua script'inde (`lua/reserve.lua`) ayırır ya da **hiçbirini**
(ADR-01). Redis script'i tek iş parçacığında çalıştırdığı için kontrol ile düşüm arasına başka istek
giremez: kısmi rezervasyon imkânsızdır. Rezervasyonun kimliği siparişin kimliğidir (`order_id`).

| Anahtar                      | Tip    | İçerik                                                                                    | Ömür         |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------- | ------------ |
| `stock:{market}:avail:{sku}` | string | Satılabilir adet; rezervasyon buradan düşer                                               | TTL'siz      |
| `resv:{market}:{orderId}`    | hash   | `qty:{sku}` (B23), `orderId`, `userId`, `marketId`, `reservedAt`, `expiresAt`, `extended` | süre + 60 sn |
| `resv:index:{market}`        | zset   | üye sipariş, skor bitiş anı (ms); süpürücü buradan okur (T10.3)                           | TTL'siz      |
| `resv:user:{userId}`         | string | Kullanıcının aktif siparişi (B22)                                                         | süre kadar   |

**Script'in adımları** (anahtar sırası B15):

1. Sipariş zaten rezerveyse sayaçlara dokunmadan döner.
2. Kullanıcının başka aktif rezervasyonu varsa reddeder.
3. Bütün sayaçları okur, **hiçbir şey yazmaz**; biri yetmezse, yoksa ya da tam sayı değilse çıkar.
4. Hepsini birden düşer; kaydı, indeksi ve kullanıcı kilidini yazar.

| Sonuç                           | gRPC / hata kodu                             | Ayrıntı                                                           |
| ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Rezerve edildi                  | OK, `expires_at`                             |                                                                   |
| Sipariş zaten rezerve           | OK, `already_reserved: true`, ilk bitiş anı  | Sayaçlar ikinci kez düşmez (ADR-08)                               |
| Bir kalem yetmedi               | `FAILED_PRECONDITION` / `STOCK_INSUFFICIENT` | `sku`, `requested`, `available` (yetmeyen ilk kalem)              |
| Sayacı olmayan SKU (#36)        | `FAILED_PRECONDITION` / `STOCK_INSUFFICIENT` | `available: 0`, `counterMissing: true`; uyarı günlüğü             |
| Kullanıcının aktif rezervasyonu | `ALREADY_EXISTS` / `RESERVATION_ACTIVE`      | `activeOrderId`; eskisini bırakıp yenisini almak order'ın (T11.2) |
| Bozuk (tam sayı olmayan) sayaç  | `INTERNAL`                                   | Hiçbir şey yazılmaz                                               |

- **Kararlar (30 Eylül, (a)x6):**
  - Kullanıcı kilidi kullanıcı başına tek anahtar. Market anahtarlarından ayrı slot'ta; tek düğümlü Redis'te
    çalışır, Cluster'a geçişte yeniden karar gerekir. Script bunu yüklemede beyan eder
    (`loadLuaScripts({ crossSlot })`), çağrı başına uyarı yazılmaz.
  - Sayacı olmayan SKU yetersiz sayılır.
  - Aynı SKU iki kalemde `VALIDATION_FAILED`. Depolar da aynı kuralla korunur; yoksa sayaç iki kez düşerdi.
- **Doğrulama:** sipariş (`ord_`) ve kullanıcı (`usr_`) kimliği biçimiyle doğrulanır, ikisi de Redis anahtarına girer.
  Kalem ve adet sınırları sepetinkiyle aynı (en fazla 50 kalem, kalem başına 1-99). Süre 30-900 sn; bu bir
  korumadır, süreyi order verir (risk bandı: 600 / 120).
- **Saat:** "şimdi" servisin saatidir (`Clock`); testler sabit saat verir.
- **MOCK** (B16): bellekte aynı kurallar; sayaçlar ve rezervasyonlar aynı haritayı paylaşır, rezervasyon
  müsaitlikte hemen görünür. İki uygulama da `test/support/reservation-store-contract.ts` senaryolarından geçer.
- **Henüz yok:** uzatma (`ExtendReservation`, T11.3); order'ın `Reserve`'ü çağırması (T11.2). Bırakma, onay
  ve süre dolumu (süpürücü) geldi (aşağıda).

## Bırakma ve stok defteri (T10.2 PR 1, ADR-18)

`Release` rezervasyonu bırakır: adetler sayaçlara döner, kullanıcı kilidi kalkar ve stok defterine
(`stock_ledger`) kalem başına bir kayıt düşer. Kullanıcı iptali, ödeme hatası ve süpürücü (T10.3) aynı
rezervasyonu aynı anda bırakmak isteyebilir; stok **tam bir kez** döner.

**Sıra (ADR-18):**

1. **Sahiplik (Redis, `lua/release.lua`):** script süre indeksindeki üyeyi siler (`ZREM`); silen çağrı işi
   yapar, diğerleri çekilir (B3, B4). Önce bütün sayaçlar **yazmadan** denetlenir (tam sayı olmayan sayaçta
   hiçbir şey yazılmaz), sonra adetler geri eklenir. Kullanıcı kilidi yalnızca bu siparişinse silinir.
2. **Kayıt silinmez, işaretlenir:** hash'e `state: released`, `reason`, `settledAt` yazılır, adetler kalır;
   ömrü en fazla 24 saattir (`SETTLED_RESERVATION_TTL_MS`).
3. **Defter (Mongo):** servis kayıtları yazar, **başarılı olunca** izi siler.
4. **Yarıda kalırsa:** defter yazılamazsa (Mongo erişilemez) istek `UNAVAILABLE` alır ama sayaçlar zaten
   dönmüştür. Aynı isteğin tekrarı izi bulur, defteri ilk gerekçe ve anla tamamlar, `ALREADY_APPLIED` alır.

Script'in dokunduğu bütün anahtarlar `KEYS`'te bildirilir (Redis Cluster kuralı): servis önce hash'i okur
(`HGETALL`), sayaçları ve kullanıcıyı oradan bilir; okuma ile script arasında kayıt değiştiyse bir kez daha
dener, yine değiştiyse `CONFLICT` (tekrar denenebilir).

| Sonuç (`ReservationOutcome`) | Ne zaman                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `APPLIED`                    | Sahiplik bu çağrının; adetler sayaçlara döndü                                |
| `ALREADY_APPLIED`            | Daha önce bırakılmıştı (iz ya da defter söyler); sayaçlar tekrar artmadı     |
| `NOT_FOUND`                  | Bırakılacak rezervasyon yok (hiç olmamış, başka markette ya da kaydı düşmüş) |

- **Stok defteri** eldeki adedin hesabıdır: bir market × SKU için `delta` toplamı `stock.onHand`'e eşittir.
  - `opening`: seed'in açılış kaydı, `delta = +onHand` (seed defteri stokla aynı transaction'da baştan yazar).
  - `release`: bırakma. Eldeki adet değişmez (`delta: 0`), adet `quantity`'de, çağıranın gerekçesi `reason`'da.
  - `commit`: onay, `delta = -adet` (T10.2 PR 2; aşağıda).
  - `expire`: süpürücünün süre dolumu, `delta: 0`, gerekçe `expired` (T10.3; aşağıda).
- **Çift kayıt yok (B14):** kaydın `_id`'si doğal anahtardır (`sipariş/sku/tür`); aynı hareket ikinci kez
  yazılırsa değişmez. İndeksler: `orderId` (kısmi) ve `marketId + sku + createdAt`.
- **Gerekçe** serbest metin değil, kısa anahtardır: küçük harf, rakam, alt çizgi, en fazla 64
  (`@getir/contracts` `RELEASE_REASON_PATTERN`). Tekrar gelen istekte ilk gerekçe kalır.
- **Sayacı olmayan kalem** atlanır, sayaç yaratılmaz (yalnızca bu adetle başlardı); uyarı yazılır. Eksik
  sayacı eldeki adetten yazmak sayaç kurtarmasının işidir (ADR-17).
- **İndekste olup kaydı düşmüş rezervasyon** (normal akışta olmaz): indeksten silinir, uyarı yazılır, stok
  geri verilemez; sonuç defterden okunur.
- **Bilinen:** iz dururken (normalde milisaniyeler) aynı sipariş kimliğiyle gelen `Reserve` "zaten rezerve"
  alır; order bırakılmış siparişi yeniden rezerve etmez (T11.2).
- **MOCK** (B16): bırakma bellekte aynı kurallarla; defter de bellektedir (Mongo'ya yazılmaz). Bellek ve
  Redis `test/support/reservation-store-contract.ts` senaryolarından birlikte geçer.
- **Olay yok:** `stock.released` olayını bugün dinleyen yok; gövdesi dinleyen gelince (order T11.2, realtime
  T12.3) inventory outbox'ıyla yazılır (T10.3 kararı).

## Onay (T10.2 PR 2, ADR-18)

`Commit` ödeme onaylandıktan sonra ayrılan adedi **kalıcı** düşürür. Sıra bırakmayla aynı:

1. **Sahiplik (Redis, `lua/commit.lua`):** `ZREM`; kullanıcı kilidi yalnızca bu siparişinse silinir; kayıt
   `state: committed` olarak işaretlenir. Stok sayaçlarına **dokunulmaz**: adet rezervasyonda zaten düşmüştü.
2. **Mongo, tek transaction:** kalem başına defter kaydı (`commit`, `delta = −adet`, gerekçe `order_paid`)
   "yoksa yaz" ile eklenir; yeni eklendiyse o kalemin `onHand`'i sürüm koşuluyla (`version`) düşer. Kayıt ile
   düşüm aynı transaction'da: tekrar gelen onay adedi iki kez düşüremez.
3. **Başarılıysa** Redis'teki iz silinir → `APPLIED`.

- **Eşzamanlı onay (roadmap P3):** aynı stok kaydına yazan iki onayda kaybeden `CONFLICT` alır ve
  mongo-kit'in `retryOnConflict` yardımcısıyla 50 / 100 / 200 ms (±%50) bekleyerek en çok 3 kez daha dener.
  Sürücünün beklemesiz kendi denemesi bu transaction'da kapalıdır (`retryTransientErrors: false`). Denemeler
  biterse `ABORTED` / `CONFLICT`; Redis izi durduğu için aynı isteğin tekrarı onayı tamamlar
  (`ALREADY_APPLIED`). Her yeniden deneme günlüğe bir bilgi satırı yazar.
- **Eksiye düşen `onHand`:** onay yine yapılır (ödeme alınmıştır), kalem başına uyarı yazılır ("fazla satış
  izi"); defterde görünür, gizlenmez.
- **Çapraz çağrılar:** onaylanmış rezervasyona `Release` → `NOT_FOUND` (stok geri gelmez); bırakılmış
  rezervasyona `Commit` → `NOT_FOUND` (order iade eder, B20). Karşı tarafın izine dokunulmaz.
- **Mongo erişilemezse** `UNAVAILABLE`; iz kalır, tekrar gelen istek tamamlar (ADR-18).
- **MOCK** (B16): eldeki adet ve defter bellekte, kurallar aynı.

## Süpürücü (T10.3, ADR-02, B25)

Süresi dolan rezervasyonun stoğunu geri verir. Keyspace notification kullanılmaz (ADR-02): tek gerçek
`resv:index:{market}` ZSET'idir, skor bitiş anı.

- **Nerede çalışır:** servisin içinde, her örnekte (`src/interfaces/workers/reservation-sweeper.ts`). Her tur
  (varsayılan 1 sn, `SWEEPER_INTERVAL_MS`) önce liderliği alır ya da yeniler; **yalnızca lider süpürür**.
- **Liderlik kilidi** `lock:reconcile` (`lua/leader.lua`): tek Redis düğümünde Redlock'un tek örnekli hâli.
  Değer örneğe özgü belirteçtir (`randomUUID`); yalnızca sahibi yeniler ya da bırakır. Ömrü 3 sn
  (`SWEEPER_LOCK_TTL_SECONDS`), her turda yenilenir: lider çökerse kilit en geç 3 sn'de boşalır ve başka örnek
  bir sonraki turunda devralır (B25).
  Kapanışta lider kilidi bırakır, devralma beklemeden olur. Ömür en az iki tur olmalı (ortam doğrular).
- **Tur:** her market için (Mongo `stock`'tan, dakikada bir tazelenir) bitiş anı gelmiş en çok 100 sipariş
  (`ZRANGEBYSCORE ... LIMIT`, en eskisi önce) `release.lua`'nın **süre dolumu kipiyle** bırakılır:
  - Script bitiş anını **yeniden** denetler; skor şimdiden sonraysa dokunmaz (`not-due`; uzatılmış olabilir).
  - Sahiplik `ZREM`: onay ya da iptal aynı anda gelse de rezervasyon tek yoldan sonuçlanır (B3).
  - Adetler sayaçlara döner, iz `state: expired`; defter `expire` (`delta: 0`, gerekçe `expired`), iz silinir.
- **Mongo erişilemezse** sayaçlar yine döner; sipariş bekleyenlere alınır, sonraki turlarda izden
  tamamlanır. Süreç yeniden başlarsa bekleyen liste kaybolur: o süre dolumunun defter kaydı eksik kalır
  (`delta: 0`, eldeki adet hesabını bozmaz); aynı siparişe gelen `Release` izi bulup tamamlar.
- **Sonuçları:** süresi dolmuş rezervasyona `Commit` → `NOT_FOUND` (order iade eder, B20); `Release` →
  `ALREADY_APPLIED` (stok zaten döndü).
- **Kaydı düşmüş indeks üyesi** (bütün örnekler 60 sn'den uzun kapalı kaldıysa hash'in payı dolar): uyarı
  yazılır, stok geri verilemez (adetler bilinmiyor); `reseed` gerekir.
- **Günlük:** lider olunca ve liderlik düşünce bir satır; stok geri verilen turda özet. Metrik ve sağlık
  T10.5'te (#12).
- **MOCK** (B16): süpürücü bellekte aynı kurallarla; tek süreç, kilit hep bizde.

## Redis boşalınca (T10.1 PR 2, ADR-17)

Redis boşalırsa (FLUSHALL, kalıcılık olmadan yeniden başlatma) sayaçların tamamı gider. Servis bunu
**kendiliğinden** fark eder ve sayaçları Mongo'dan yeniden yazar; `reseed` ya da yeniden başlatma gerekmez.

- **İşaret:** sayaçlar her yazıldığında (açılış, `seed`, `reseed`) en son `stock:seeded` konur. TTL'sizdir
  (ADR-17), market başına değil tektir.
- **Ne zaman bakılır:** yalnızca bir sayaç **bulunamadığında** (`CheckAvailability`'de bilinmeyen SKU,
  `Reserve`'de sayaçsız kalem). Normal istekte ek maliyet yoktur.
  - İşaret yerindeyse Redis boşalmamıştır; SKU gerçekten bu markette yoktur (`unknown_skus`, `counterMissing`).
  - İşaret yoksa sayaçlar Mongo'dan yazılır (yalnızca eksikler, `SET NX`), işaret yeniden konur ve istek
    **bir kez** tekrarlanır. Kullanıcı fark etmez.
- **Tek uçuş:** aynı anda gelen istekler aynı kurulumu bekler. Bekleme en fazla 5 sn; aşılırsa ya da kurulum
  düşerse `SERVICE_UNAVAILABLE` (tekrar denenebilir), kurulum arka planda sürer. Günlükte bir uyarı ("stok
  sayaclari Redis'te yok ... yeniden yaziliyor") ve bir bilgi satırı (okunan ve yazılan sayaç) kalır.
- **Kaybolanlar:** Redis ile birlikte aktif rezervasyonlar da gider; sayaçlar eldeki adetten yazılır.
  Kaybolan rezervasyonun siparişi onayda "bulunamadı" alır (T10.2, B20). Onay ve defter gelince formül B24'e
  göre genişler.
- Birden çok servis örneği aynı anda fark ederse ikisi de yalnızca eksik sayaçları yazar; zararsızdır.

## Açılış (T9.2)

1. Mongo'ya bağlanır, `stock` ve `stock_ledger` indekslerini kurar; Redis'e bağlanır.
2. **Redis tahliye politikası** (`maxmemory-policy`) okunur: `noeviction` değilse ya da okunamıyorsa
   servis **açılmaz** (roadmap P1). Bellek dolunca sayacı silen bir Redis fazla satış demektir.
3. Sayaçlar Mongo'dan yazılır, **yalnızca olmayanlar** (`SET NX`): var olan sayaç rezervasyonları
   yansıtır (T10); ezilseydi ayrılmış stok yeniden satılırdı. En son sayaç kümesinin işareti
   (`stock:seeded`, ADR-17) konur.
4. Lua script'leri (`lua/`) Redis'e yüklenir (T10.1): klasör eksikse servis açılmaz, ilk rezervasyonda
   patlamaz. Redis yeniden başlayıp script'i unutursa ilk çağrı yeniden yükler (redis-kit, `NOSCRIPT`).
5. gRPC portu **ancak bundan sonra** açılır: sayaçlar yazılmadan servis hazır görünmez.

`MOCK=true` iken Mongo ve Redis'e hiç dokunulmaz; demo stoğu bellektedir. Değilse
`INVENTORY_MONGO_URI` ve `REDIS_URL` zorunludur: servis kendi veritabanına (`getir_inventory`) kendi
Mongo kullanıcısıyla bağlanır, kullanıcı yalnızca orada yetkilidir (D14, ADR-05).

## Komutlar

```bash
pnpm seed                                            # kokten: katalog + stok ve defter (Mongo), sayaçlar (Redis) baştan
pnpm --filter @getir/inventory-service reseed         # Redis sayaçlarını Mongo'dan BAŞTAN yazar
pnpm --filter @getir/inventory-service build && MOCK=true pnpm --filter @getir/inventory-service start  # :50052

grpcurl -plaintext -import-path packages/proto/proto -proto getir/inventory/v1/inventory.proto \
  -d '{"market_id":"mkt_migros-jet-moda","skus":["SUT-1L","KOLA-1L","CIKOLATA-80"]}' \
  localhost:50052 getir.inventory.v1.InventoryService/CheckAvailability

grpcurl -plaintext -import-path packages/proto/proto -proto getir/inventory/v1/inventory.proto \
  -d '{"order_id":"ord_00000000000000000000000000000001","market_id":"mkt_migros-jet-moda",
       "user_id":"usr_00000000000000000000000000000001","ttl_seconds":600,
       "items":[{"sku":"SUT-1L","quantity":2},{"sku":"CIKOLATA-80","quantity":1}]}' \
  localhost:50052 getir.inventory.v1.InventoryService/Reserve

grpcurl -plaintext -import-path packages/proto/proto -proto getir/inventory/v1/inventory.proto \
  -d '{"order_id":"ord_00000000000000000000000000000001","market_id":"mkt_migros-jet-moda",
       "reason":"user_cancelled"}' \
  localhost:50052 getir.inventory.v1.InventoryService/Release
```

- **`seed`** kalıcı stoğu ve stok defterini (açılış kayıtları) tek transaction'da baştan yazar ve sayaçları
  ondan yeniden kurar (seed stok gerçeğini topluca değiştirir; sayaçlar yenilenmezse Redis eski stoğu
  gösterirdi). `NODE_ENV=production` iken reddeder. T10.2'den önce seed edilmiş veritabanında defter boştur;
  `pnpm seed` bir kez koşulur.
- **`reseed`** bütün sayaçları Mongo'dan **baştan** yazar (bilinçli komut). Redis boşaldığında artık gerekmez:
  servis boşalmayı kendiliğinden fark edip eksik sayaçları yazar (yukarıda, T10.1 PR 2). **Dikkat:** aktif
  rezervasyon varken çalıştırılırsa ayrılmış stok geri satışa çıkar; Redis boşken ya da rezervasyon
  yokken koşulur. Sayaçlardan sonra **defter denetimi** (T10.2 PR 2, B24): her market × SKU için defter
  toplamı `onHand` ile karşılaştırılır; tutarsa bilgi satırı, tutmazsa ilk 10 fark ve toplam sayıyla uyarı
  (reseed düşmez).

## Demo stoğu

`src/infrastructure/fixtures/stock-levels.ts`: kataloğun 71 teklifinin **her birinin** stok kaydı var
(`test/unit/stock-fixtures.spec.ts` kataloğun demo verisiyle karşılaştırır). Bilerek konanlar:

- her markette bir **"tükendi"** (0) ve bir **"son 2 adet"** kalemi;
- Migros Jet – Moda'da çikolata **1 adet**: yarış senaryosu (T11.1, "stok 1, 100 paralel istek");
- diğerleri 20-60 arası, sabit: tekrar koşan seed aynı stoğu yazar.

## Klasörler

```text
lua/               reserve.lua (T10.1), release.lua ve commit.lua (T10.2), leader.lua (T10.3); imaja
                   package.json "files" ile girer
src/
  application/     check-availability, reserve-stock, release-reservation, commit-reservation,
                   reservation-result, sweep-expired, seed-stock, seed-counters, counter-recovery,
                   check-ledger
  domain/          stock.ts, reservation.ts, stock-ledger.ts, stock-ports.ts, leader-lock.ts: kavramlar ve
                   portlar (depo yok)
  infrastructure/  fixtures, memory (MOCK: sayaçlar + rezervasyon + defter + onay yazımı + liderlik),
                   mongo (stock, stock_ledger, onay transaction'ı),
                   redis (sayaçlar, işaret, rezervasyon + hash ön okuması, liderlik kilidi, Lua yükleyici,
                   tahliye denetimi),
                   stock-stores (bağlantılar), stock-source (açılış)
  interfaces/grpc/ handler, şema (Zod), eşleyici
  interfaces/workers/ süpürücü işçi (T10.3)
  main.ts · seed.ts · reseed.ts · healthcheck.ts
```

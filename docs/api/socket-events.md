# Socket.io sözleşmesi

Gerçek zamanlı katman `realtime-service` üzerinde **3001** portunda çalışır
(metrik ucu 4001, sağlık `GET /healthz` 3001'de). REST sözleşmesi:
[`openapi.yaml`](openapi.yaml).

Sunucu olayları iç olay veri yolundan (Redis Streams) alır ve yalnızca odaya
yayınlar; istemci sunucuya **veri yazmaz**. Bu yüzden aşağıdaki tabloda tek bir
istemci → sunucu olayı vardır (`room.join`), geri kalanı tek yönlüdür.

> **Bugünkü durum (T12.3):** sunucu, odalar, oda yetkisi, kopyalar arası yayın
> (Redis adapter) ve **`order.status` canlı**: sipariş her durum değiştirdiğinde
> olay ~1 sn içinde siparişin odasına gelir (bkz. "order.status teslimi").
> Diğer olayların yayını henüz yok: `reservation.expiring` /
> `reservation.released` bekleyen iş #82; `stock.changed` bekleyen iş #83 (önce
> inventory'nin olayı üretmesi gerekir); kurye olayları T13/T14. Tablolar hedef
> sözleşmedir.

## İstemci notu (web)

- **Yalnızca websocket:** istemci `transports: ['websocket']` ile bağlanmalıdır.
  Sunucu HTTP yoklamasını (polling) kabul etmez; böylece birden çok realtime
  kopyası yük dengeleyicide yapışkan oturum istemez (ADR-06 eki).
- **Geliştirmede proxy:** web, gateway'e gittiği gibi realtime'a da kendi
  kaynağından gider. Vite proxy'ye `/socket.io` → `http://localhost:3001`
  (`ws: true`) eklenmelidir (web işi, frontend'in).
- İstemciden giden tek paket en fazla **4 KB** olabilir; aşan paket bağlantıyı
  keser (`room.join` gövdesi ~400 bayttır).

## Odalar

| Oda                | Kim girebilir                                                                                                    | Ne taşır                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `order:{orderId}`  | **Yalnızca siparişin sahibi.** Giriş için `GET /v1/orders/{id}/token` ile alınan kısa ömürlü oda jetonu şarttır. | Siparişin kendi yaşam döngüsü: durum, rezervasyon uyarıları, kurye ataması ve konumu, teslimat. |
| `store:{marketId}` | **Herkes.** Kimlik doğrulaması istenmez, anonim bağlantı da girebilir.                                           | Yalnızca stok değişimi (`stock.changed`). Başka hiçbir olay bu odaya yayınlanmaz.               |

**Anonim bağlantı yalnızca `store:{marketId}` odasına girebilir.** Jetonsuz bir
soket `order:*` odasına katılmayı denerse sunucu odaya almaz ve `FORBIDDEN`
ile karşılık verir. Sipariş odaları kişisel veri (adres, kurye konumu, tutar)
taşıdığı için bu sınır sunucu tarafında zorunlu tutulur; istemcinin "hangi odaya
gireceğim" kararına güvenilmez.

**Oda adı biçimi** (contracts `roomSchema`): `order:` + sipariş kimliği
(`ord_` + 32 küçük onaltılık) ya da `store:` + market kimliği (`mkt_…`);
toplam en fazla 70 karakter. `order:`, `store:`, başka önek, yanlış biçimli
kimlik ya da aşırı uzun ad `VALIDATION_FAILED` döner.

### Oda jetonu

Jeton `GET /v1/orders/{id}/token` ile alınır ve **`room.join` gövdesinde**
taşınır (bağlantı kurulurken değil; bir bağlantı birden çok odaya girebilir).
İstemci için opaktır: web yalnızca metni iletir. Sunucu tarafı için içeriği
(contracts `REALTIME_TOKEN`):

| Alan         | Değer                                                 |
| ------------ | ----------------------------------------------------- |
| imza         | **Yalnızca HS256**; `alg: none`, HS512 vb. reddedilir |
| `iss`        | `getir-gateway`                                       |
| `aud`        | `realtime` (erişim jetonunda yoktur)                  |
| `sub`        | Siparişin sahibi (`usr_…`)                            |
| `room`       | `order:{orderId}`: jetonun yetkili olduğu **tek** oda |
| `iat`, `exp` | Zorunlu; ömür **60 sn** (`exp - iat` 60'ı aşamaz)     |

- **Ayrı sır:** jeton erişim jetonundan farklı bir sırla imzalanır
  (`REALTIME_TOKEN_SECRET`). Gateway bu sırrın `JWT_SECRET` ile aynı olmasına
  izin vermez; iki sırrın bir arada durduğu tek yer gateway'dir. Realtime
  `JWT_SECRET`'ı **hiç bilmez** (en az yetki); erişim jetonu aynı sırla imzalanmış
  olsa bile `aud = realtime` taşımadığı için reddedilir.
- **Yalnızca katılımda denetlenir:** jetonun süresi dolunca odadaki soket
  **atılmaz**. Süresi dolan jetonla **yeniden bağlanan** istemci REST'ten yenisini
  alır.
- **Tekrar kullanılabilir:** jetonda `jti` yoktur; aynı jeton ömrü içinde birden
  çok sokette (ör. iki sekme) kullanılabilir, ama yalnızca kendi odası için.
- **Saat payı 5 sn:** `exp`'ten sonraki 5 sn'den az süre kabul edilir (`exp`+4 sn
  kabul, `exp`+5 sn red); `iat` ya da `nbf` bu payın ötesinde gelecekteyse jeton
  reddedilir.
- Gateway'de uç: başkasının siparişi **`404 NOT_FOUND`** (var olduğu sızdırılmaz);
  iptal ya da teslim edilmiş siparişin sahibi de jeton alır (son durumu izler).

## Olaylar

| Olay                   | Oda                | Yön              | Yetki                                             | Payload                                                                                                                                      |
| ---------------------- | ------------------ | ---------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `room.join`            | —                  | istemci → sunucu | `order:*` için oda jetonu; `store:*` için serbest | `{ room: string, token?: string }` — ack: `{ success: true, data: { room } }` veya `{ success: false, error: { code, message, requestId } }` |
| `order.status`         | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, status, previousStatus, at, seq }`                                                                                               |
| `reservation.expiring` | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, expiresAt, remainingSeconds, seq }`                                                                                              |
| `reservation.released` | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, reason, releasedAt, seq }`                                                                                                       |
| `courier.assigned`     | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, courier: { id, name, location, etaMinutes }, at, seq }`                                                                          |
| `courier.location`     | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, courierId, location: { lat, lng }, etaMinutes, at, seq }`                                                                        |
| `order.delivered`      | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, deliveredAt, seq }`                                                                                                              |
| `stock.changed`        | `store:{marketId}` | sunucu → istemci | Herkes (anonim dahil)                             | `{ marketId, productId, availableQuantity, at }`                                                                                             |

### İç olay adı ↔ soket olay adı

Bunlar **iki ayrı sözlüktür** ve bilerek birebir aynı değildir: iç olaylar
(`packages/core` → `EVENTS`) Redis Streams üzerinde servisler arasında akar ve
domain diliyle yazılır; soket olayları tarayıcıya gider ve istemcinin ihtiyacına
göre sadeleştirilir. `realtime-service` bu çeviriyi tek yerde yapar.

| İç olay (Redis Streams)                                                                     | Soket olayı            | Not                                                                              |
| ------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `order.status_changed`                                                                      | `order.status`         | Aynı olay (T12.3): `to` → `status`, `from` → `previousStatus`, `version` → `seq` |
| `stock.released`                                                                            | `reservation.released` | Sipariş odasına, kullanıcının kendi rezervasyonu için                            |
| `stock.changed`                                                                             | `stock.changed`        | Depo odasına yayın; birebir aynı ad                                              |
| `courier.assigned`                                                                          | `courier.assigned`     | Birebir aynı                                                                     |
| `courier.location`                                                                          | `courier.location`     | Birebir aynı                                                                     |
| `order.delivered`                                                                           | `order.delivered`      | Birebir aynı                                                                     |
| —                                                                                           | `reservation.expiring` | Karşılığı olan iç olay yok: realtime, `expiresAt` üzerinden kendisi üretir       |
| `order.created`, `stock.reserved`, `stock.committed`, `payment.succeeded`, `payment.failed` | —                      | İç kalır; tarayıcıya ayrı olay olarak yayınlanmaz, `order.status` içinde görünür |

### Alan notları

- **`seq`** — sipariş odasındaki her olay, o sipariş için monoton artan bir
  sıra numarası taşır. Socket.io yeniden bağlanmada olay sırasını garanti
  etmediği için istemci, gördüğü en büyük `seq` değerinden küçük ya da eşit gelen
  olayı **yok sayar**. Özellikle `courier.location` COURIER_TICK_MS (2000 ms)
  aralığıyla aktığından, gecikmeli gelen eski bir konum haritada kuryeyi geri
  sıçratmamalıdır. `order.status`'ta `seq` **siparişin sürümüdür** (T12.3): taslak
  1. sürümdür, ilk geçiş 2'dir; artar ama aralıksız olmak zorunda değildir
     (siparişin durum dışı güncellemeleri de sürümü artırır).
- **`status`** — Tek doğruluk kaynağı `packages/core/src/constants.ts` içindeki
  `ORDER_STATUS` sabitidir; `openapi.yaml` içindeki `OrderStatus` enum'u da aynı
  listedir: `DRAFT`, `RISK_CHECK`, `REVIEW`, `RESERVED`, `AWAITING_PAYMENT`,
  `PAID`, `PAYMENT_FAILED`, `EXPIRED`, `CANCELLED`, `REJECTED`, `PREPARING`,
  `ON_THE_WAY`, `DELIVERED`.
- **`reservation.expiring`** — rezervasyon süresi dolmadan önce uyarı olarak
  gönderilir; `remainingSeconds` geri sayım için doğrudan kullanılır. Süre
  RESERVATION_TTL_SECONDS (600 sn), risk orta seviyedeyse
  RESERVATION_TTL_MEDIUM_RISK_SECONDS (120 sn) üzerinden işler.
- **`reservation.released`** — `reason` alanı `EXPIRED` (sweeper topladı),
  `CANCELLED` (kullanıcı iptal etti) veya `PAYMENT_FAILED` (saga telafisi)
  değerlerinden biridir. Sweeper SWEEPER_INTERVAL_MS (1000 ms) aralığıyla tarar.
- **`at` / `deliveredAt` / `expiresAt` / `releasedAt`** — ISO 8601 UTC dizgisi.
- **Para alanı yok:** bu olaylar tutar taşımaz. Tutar gerektiğinde istemci
  `GET /v1/orders/{id}` ile okur; böylece kuruş mantığı tek yerde kalır.

### Yayın kuralları (sunucu)

Her olay realtime'daki tek yayın kapısından geçer (`application/broadcast.ts`):

- Gövde contracts şemasından geçer; geçmeyen olay **yayınlanmaz**, sayılır ve
  günlüğe gövdesiz yazılır. Yayınlanan, şemanın ayrıştırdığı değerdir: şemada
  olmayan alan (ör. `sku`) istemciye sızmaz.
- `stock.changed` yalnızca `store:*` odasına, diğer olaylar yalnızca `order:*`
  odasına gider; olaydaki `orderId`/`marketId` odanınkiyle aynı olmalıdır.
- Redis adapter sayesinde bir kopyadan yapılan yayın bütün kopyalardaki
  soketlere ulaşır.

### `order.status` teslimi (T12.3)

- **Kaynak:** order her durum geçişinde iç olay `order.status_changed` yazar
  (outbox → `stream:events`). Realtime `realtime` tüketici grubunda dinler ve
  siparişin odasına `{ orderId, status, previousStatus?, at, seq }` yayınlar.
  Tek yazımda birden çok geçiş olabilir (risk adımı: `RISK_CHECK` → `RESERVED` →
  `AWAITING_PAYMENT`); her biri ayrı olaydır ve kendi `seq`'ini (geçişin sürümü)
  taşır. Sürümler order'da ardışıktır, ama istemciye hepsinin ulaşacağı garanti
  edilmez (aşağıda "Ara sürüm atlanabilir").
- **`at`** geçişin zaman çizelgesindeki anıdır (yayın anı değil).
- **En az bir kez teslim:** aynı olay istemciye birden fazla kez gelebilir
  (realtime yayından sonra çökerse olay yeniden teslim edilir ve yeniden
  yayınlanır). **İstemci `seq` ≤ gördüğü değerse olayı atar**; tekrar zararsızdır.
- **Kopya çökerse geç gelir:** realtime kopyası olayı işlerken çökerse olay ~30 sn
  sonra (`claimIdleMs`) başka kopyaca yeniden teslim edilir; 1 sn hedefi normal
  yol içindir.
- **Eski sürüm yayınlanmaz:** realtime siparişe yayınladığı son sürümü Redis'te
  tutar (`realtime:{orderId}:seq`, 24 saat ömür, her yazımda yenilenir) ve daha
  eski sürümü odaya göndermez. Eşit sürüm (aynı olayın tekrarı) yeniden yayınlanır.
- **Ara sürüm atlanabilir:** iki kopyada eşzamanlı geçişlerde ara sürüm
  yayınlanmayabilir; `seq` boşluklu gelebilir ve `previousStatus` zinciri tam
  olmayabilir. İstemci yalnızca `seq` ≤ gördüğü değerse olayı atar; boşluğu kayıp
  saymaz, gerekirse `GET /v1/orders/{id}` ile durumu tazeler.
- **Yalnızca bağlantıdan sonrası:** grup ilk kez kurulurken yalnızca bundan sonraki
  olayları okur; soket akışı geçmişi oynatmaz. İstemci odaya katılınca durumu
  `GET /v1/orders/{id}` ile bir kez okur, sonra olayları uygular.
- **Süre:** order'ın outbox yayıncısı en fazla ~500 ms'de bir basar, tüketici
  yeni kaydı beklemeden alır; geçişten istemciye hedef **1 sn**.
- İç alanlar (`userId`, iptal notu) sokete çıkmaz.

## Bağlantı akışı

1. İstemci `GET /v1/orders/{id}/token` ile oda jetonunu alır (yalnızca sipariş
   odası için gerekir).
2. Socket.io bağlantısı kurulur (jetonsuz; `transports: ['websocket']`).
3. İstemci `room.join { room, token? }` gönderir; sunucu ack döner.
4. Sunucu odaya yayın yapar; istemci `seq` kuralına göre olayları uygular.
5. Yeniden bağlanmada 1–3 adımları tekrarlanır ve istemci eksik kalan durumu
   `GET /v1/orders/{id}` ile bir kez tazeler; soket akışı geçmişi tekrar
   oynatmaz.

### `room.join` nasıl karar verir

Denetimler **bu sırayla** yapılır; ilk takılan karar verir:

1. **Sınır:** aynı soketten 10 sn içinde en fazla **10** deneme. Fazlası
   `RATE_LIMITED`; 11. deneme bozuk bir adla da olsa `RATE_LIMITED` döner. Sayaç
   **sokete bağlıdır** ve bellektedir: yeniden bağlanan istemcinin sayacı sıfırdır
   (bilinçli: amaç kaba kuvvet ve hatalı istemci döngüsü, yeniden bağlanmayı
   cezalandırmak değil).
2. **Gövde ve oda adı:** sözleşmeye uymayan gövde, oda adı ya da metin olmayan
   `token` → `VALIDATION_FAILED`.
3. **Market odası:** `store:*` her zaman kabul edilir; gönderilen jeton **yok
   sayılır**.
4. **Sipariş odası:** `token` yoksa ya da boş metinse → `FORBIDDEN`. Jeton
   doğrulanamıyorsa (imza, algoritma, `iss`, `aud`, süre, ömür, biçim) ya da
   başka bir odaya aitse → `UNAUTHORIZED`.

Aynı odaya ikinci kez katılmak hata değildir: ack yine başarılıdır, olaylar
sokete bir kez gelir. Reddedilen her deneme sunucu günlüğüne gerekçesiyle
yazılır (jetonun kendisi yazılmaz).

### Ack zarfı

REST ile aynı zarf (contracts `envelope.ts`):

```text
Başarı: { "success": true, "data": { "room": "order:ord_db77f4c0e24f49919cc1d78a649c9c94" } }
Hata:   { "success": false, "error": { "code": "FORBIDDEN", "message": "Bu işlem için yetkin yok.", "requestId": "req_…" } }
```

- `message` Türkçe hata sözlüğünden gelir (contracts `ERROR_MESSAGES`); reddin iç
  gerekçesi (ör. "jetonun süresi dolmuş") istemciye gitmez.
- `requestId` **bağlantının** korelasyon kimliğidir: el sıkışmadaki
  `x-request-id` başlığı yalnızca `req_` + 32 küçük onaltılık biçimindeyse
  kabul edilir, değilse sunucu üretir (gateway ile aynı kural, #22). Tarayıcı
  websocket'e başlık ekleyemediği için web'de kimliği hep sunucu üretir.

## Hata kodları

Ack gövdesindeki `error.code` değerleri [`openapi.yaml`](openapi.yaml) içindeki
`ErrorCode` sözlüğünden gelir. Realtime bu katmanda yalnızca şunları üretir:

| Kod                   | Ne zaman                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`   | Gövde ya da oda adı sözleşme dışı; `token` metin değil.                                                       |
| `FORBIDDEN`           | `order:*` odasına jetonsuz (ya da boş jetonla) katılma denemesi.                                              |
| `UNAUTHORIZED`        | Jeton bozuk, süresi dolmuş, ömrü 60 sn'yi aşıyor, başka bir odaya ait ya da erişim jetonu (oda jetonu değil). |
| `RATE_LIMITED`        | Aynı soketten pencere başına 10'dan fazla `room.join`.                                                        |
| `SERVICE_UNAVAILABLE` | Yalnızca `MOCK=true` ve sırsız kopyada jetonlu `order:*` denemesi (sipariş odaları kapalı; geliştirme).       |
| `INTERNAL`            | Beklenmeyen sunucu hatası.                                                                                    |

**`NOT_FOUND` realtime'dan gelmez:** realtime siparişin varlığını bilmez (gRPC
çağırmaz). Olmayan ya da başkasına ait sipariş, jeton istenirken
`GET /v1/orders/{id}/token` ucundan `404` döner.

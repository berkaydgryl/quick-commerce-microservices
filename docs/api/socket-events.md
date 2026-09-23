# Socket.io sözleşmesi

Gerçek zamanlı katman `realtime-service` üzerinde **3001** portunda çalışır.
REST sözleşmesi: [`openapi.yaml`](openapi.yaml).

Sunucu olayları iç olay veri yolundan (Redis Streams) alır ve yalnızca odaya
yayınlar; istemci sunucuya **veri yazmaz**. Bu yüzden aşağıdaki tabloda tek bir
istemci → sunucu olayı vardır (`room.join`), geri kalanı tek yönlüdür.

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

Oda jetonu yalnızca **tek bir odaya** yetkilidir (`RealtimeToken.room`) ve
kısa ömürlüdür; süresi dolan jetonla yeniden bağlanan istemci REST'ten yenisini
alır. Geçersiz veya süresi dolmuş jeton `UNAUTHORIZED` döndürür.

## Olaylar

| Olay                   | Oda                | Yön              | Yetki                                             | Payload                                                                                                                  |
| ---------------------- | ------------------ | ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `room.join`            | —                  | istemci → sunucu | `order:*` için oda jetonu; `store:*` için serbest | `{ room: string, token?: string }` — ack: `{ success: true, data: { room } }` veya `{ success: false, error: { code } }` |
| `order.status`         | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, status, previousStatus, at, seq }`                                                                           |
| `reservation.expiring` | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, expiresAt, remainingSeconds, seq }`                                                                          |
| `reservation.released` | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, reason, releasedAt, seq }`                                                                                   |
| `courier.assigned`     | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, courier: { id, name, location, etaMinutes }, at, seq }`                                                      |
| `courier.location`     | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, courierId, location: { lat, lng }, etaMinutes, at, seq }`                                                    |
| `order.delivered`      | `order:{orderId}`  | sunucu → istemci | Sipariş sahibi                                    | `{ orderId, deliveredAt, seq }`                                                                                          |
| `stock.changed`        | `store:{marketId}` | sunucu → istemci | Herkes (anonim dahil)                             | `{ marketId, productId, availableQuantity, at }`                                                                         |

### İç olay adı ↔ soket olay adı

Bunlar **iki ayrı sözlüktür** ve bilerek birebir aynı değildir: iç olaylar
(`packages/core` → `EVENTS`) Redis Streams üzerinde servisler arasında akar ve
domain diliyle yazılır; soket olayları tarayıcıya gider ve istemcinin ihtiyacına
göre sadeleştirilir. `realtime-service` bu çeviriyi tek yerde yapar.

| İç olay (Redis Streams)                                                                     | Soket olayı            | Not                                                                              |
| ------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `order.status_changed`                                                                      | `order.status`         | Aynı olay; soket tarafında kısa ad kullanılır                                    |
| `stock.released`                                                                            | `reservation.released` | Sipariş odasına, kullanıcının kendi rezervasyonu için                            |
| `stock.changed`                                                                             | `stock.changed`        | Depo odasına yayın; birebir aynı ad                                              |
| `courier.assigned`                                                                          | `courier.assigned`     | Birebir aynı                                                                     |
| `courier.location`                                                                          | `courier.location`     | Birebir aynı                                                                     |
| `order.delivered`                                                                           | `order.delivered`      | Birebir aynı                                                                     |
| —                                                                                           | `reservation.expiring` | Karşılığı olan iç olay yok: realtime, `expiresAt` üzerinden kendisi üretir       |
| `order.created`, `stock.reserved`, `stock.committed`, `payment.succeeded`, `payment.failed` | —                      | İç kalır; tarayıcıya ayrı olay olarak yayınlanmaz, `order.status` içinde görünür |

### Alan notları

- **`seq`** — sipariş odasındaki her olay, o sipariş için 1'den başlayan ve
  monoton artan bir sıra numarası taşır. Socket.io yeniden bağlanmada olay
  sırasını garanti etmediği için istemci, gördüğü en büyük `seq` değerinden
  küçük ya da eşit gelen olayı **yok sayar**. Özellikle `courier.location`
  COURIER_TICK_MS (2000 ms) aralığıyla aktığından, gecikmeli gelen eski bir
  konum haritada kuryeyi geri sıçratmamalıdır.
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

## Bağlantı akışı

1. İstemci `GET /v1/orders/{id}/token` ile oda jetonunu alır (yalnızca sipariş
   odası için gerekir).
2. Socket.io bağlantısı kurulur.
3. İstemci `room.join` gönderir; sunucu jetonu doğrular, odanın jetondaki
   `room` ile eşleştiğini kontrol eder ve ack döner.
4. Sunucu odaya yayın yapar; istemci `seq` kuralına göre olayları uygular.
5. Yeniden bağlanmada 1–3 adımları tekrarlanır ve istemci eksik kalan durumu
   `GET /v1/orders/{id}` ile bir kez tazeler; soket akışı geçmişi tekrar
   oynatmaz.

## Hata kodları

Ack gövdesi REST ile aynı zarfı kullanır ve `error.code` değerleri
[`openapi.yaml`](openapi.yaml) içindeki `ErrorCode` sözlüğünden gelir. Bu katmanda
en çok görülenler:

| Kod            | Ne zaman                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| `UNAUTHORIZED` | Jeton bozuk, süresi dolmuş ya da başka bir odaya ait.                                 |
| `FORBIDDEN`    | Jetonsuz bağlantı `order:*` odasına girmeye çalıştı ya da sipariş başka kullanıcının. |
| `NOT_FOUND`    | Oda adındaki sipariş yok.                                                             |
| `RATE_LIMITED` | Aynı soketten çok sayıda `room.join` denemesi.                                        |

# @getir/realtime-service

Gerçek zamanlı katman: Socket.io odaları, oda yetkisi ve kopyalar arası yayın (ADR-06). Gateway'den
ayrı bir süreçtir; REST ve gRPC sunmaz. Sözleşme: [`docs/api/socket-events.md`](../../docs/api/socket-events.md).

## Bugünkü durum (T12.1 + T12.2 + T12.3)

| Parça              | Durum                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Socket.io sunucusu | ✅ :3001, yalnızca websocket, istemci paketi en fazla 4 KB                                   |
| Oda modeli         | ✅ `order:{orderId}` (sahibi, jetonla), `store:{marketId}` (herkese açık) — `domain/room.ts` |
| Oda yetkisi        | ✅ `room.join` + gateway'in oda jetonu (HS256, ayrı sır) — `domain/room-access.ts`           |
| Redis adapter      | ✅ pub/sub; kopyalar odaları paylaşır (`MOCK=true`'da bellek, tek kopya)                     |
| Yayın kapısı       | ✅ `application/broadcast.ts` (şema + oda kuralı); olay tüketicisi ve testler kullanır       |
| Sağlık, metrik, iz | ✅ `GET /healthz` (:3001), `/metrics` (:4001), `room.join` span'i                            |
| `order.status`     | ✅ T12.3: `order.status_changed` → sipariş odası; `seq` = sürüm, eskisi atılır               |
| Diğer iş olayları  | ⏳ #82: `reservation.*` · #83: `stock.changed` · T13/T14: kurye                              |

## Çalıştırma

```bash
pnpm --filter @getir/realtime-service build
pnpm --filter @getir/realtime-service start      # kök .env okunur
curl -s localhost:3001/healthz                   # {"status":"SERVING"}
curl -s localhost:4001/metrics | grep realtime_
```

| Değişken                      | Ne                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `REALTIME_PORT`               | 3001; metrik ucu +1000 (4001)                                                         |
| `REALTIME_TOKEN_SECRET`       | Oda jetonunun sırrı; **gateway ile aynı değer**, `JWT_SECRET`'tan farklı; ≥ 32 bayt   |
| `REDIS_URL`                   | Adapter'ın pub/sub bağlantıları ve olay tüketicisi (`MOCK=false`'ta zorunlu)          |
| `MOCK`                        | `true`: Redis'siz, bellek adapter'ı; sır yoksa sipariş odaları kapalı (uyarı yazılır) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | İzler (D15); boşsa oluşur ama dışarı gönderilmez                                      |

## Odaya katılma

İstemci bağlanır (jetonsuz) ve `room.join { room, token? }` gönderir; ack REST ile aynı zarftır.
Sıra: **sınır → gövde ve oda adı → (yalnızca sipariş odasında) jeton → yetki**.

| Durum                                                   | Ack                                 |
| ------------------------------------------------------- | ----------------------------------- |
| `store:*` (jeton gönderilse de bakılmaz)                | `{ success: true, data: { room } }` |
| `order:*`, jeton geçerli ve odası aynı                  | `{ success: true, data: { room } }` |
| `order:*`, jeton yok ya da boş metin                    | `FORBIDDEN`                         |
| Jeton bozuk, süresi dolmuş, başka odanın, erişim jetonu | `UNAUTHORIZED`                      |
| Gövde ya da oda adı sözleşme dışı, jeton metin değil    | `VALIDATION_FAILED`                 |
| Aynı soketten 10 sn'de 10'dan fazla deneme              | `RATE_LIMITED`                      |
| Sırsız kopya (yalnızca `MOCK`) ve jetonlu `order:*`     | `SERVICE_UNAVAILABLE`               |

Jeton yalnızca **katılımda** denetlenir: süresi dolunca soket odadan atılmaz. Red `info` günlüğüne
gerekçesiyle yazılır (B28); jeton günlüğe yazılmaz.

## Kopyalar arası yayın

`@socket.io/redis-adapter` iki bağlantı açar (`realtime-pub`, `realtime-sub`; kanal öneki `realtime`).
Redis'e **anahtar yazılmaz**, yalnızca pub/sub. Bir kopyada `broadcast(room, event, payload)` çağrısı
bütün kopyalardaki soketlere ulaşır (entegrasyon testi: üç kopya). Taşıma yalnızca websocket olduğu için
yük dengeleyicide yapışkan oturum gerekmez.

## Sipariş durumu (T12.3)

Realtime, `stream:events`'teki `order.status_changed`'i **`realtime`** tüketici grubunda dinler
(`GROUP_START.LATEST`: grup ilk kurulurken yalnızca sonraki olaylar). Kopyalar grupta işi paylaşır; her
olay tek kopyada işlenir, Redis adapter yayını bütün kopyalara dağıtır.

1. `interfaces/workers/order-status-changed.ts`: gövde contracts `orderStatusChangedPayloadSchema`'dan
   geçer; geçmezse olay reddedilir (ölü olaylar).
2. `application/publish-order-status.ts`: iç olay soket olayına çevrilir (`to` → `status`, `from` →
   `previousStatus`, `version` → `seq`, zarfın `occurredAt`'i → `at`; `userId` ve not çıkmaz). Sürüm
   Redis'te **atomik** karşılaştırılır (`infrastructure/redis-seq-store.ts`: `MULTI` içinde `ZSCORE` +
   `ZADD GT` + `PEXPIRE`, anahtar `realtime:{orderId}:seq`, 24 saat). Eski sürüm yayınlanmaz; eşit sürüm
   (aynı olayın tekrarı) yeniden yayınlanır: teslim en az bir kez, istemci `seq` ≤ gördüğünü atar.
3. Yayın kapısı (`broadcast.ts`) `order:{orderId}` odasına yollar.

Günlükçü event-bus'tan gelir ve zarfın `requestId`'sini taşır; işleyici tüketici span'inin içinde
çalışır (D16): siparişi değiştiren isteğin günlük ve iz zinciri realtime'a kadar uzanır. `MOCK=true`'da
Redis olmadığı için dinleme kapalıdır. Kapanışta önce tüketici durur, sonra Socket.io.

## Metrikler

| Metrik                          | Etiketler                                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| `realtime_connections`          | —                                                                  |
| `realtime_room_joins_total`     | `room` (order, store, invalid), `outcome` (joined ya da hata kodu) |
| `realtime_events_emitted_total` | `event`                                                            |
| `realtime_events_dropped_total` | `event`                                                            |
| `realtime_events_stale_total`   | `event` (daha yeni sürüm yayınlanmıştı, T12.3)                     |

## Kapanış

SIGTERM: sağlık 503 → olay dinleme durur (eldeki parti biter, T12.3) → Socket.io kapanır (istemciler "transport close" görür ve yeniden bağlanır) →
Redis bağlantıları → metrik ucu → izler. Her adım süreyle sınırlı.

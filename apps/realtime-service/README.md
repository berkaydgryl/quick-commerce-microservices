# @getir/realtime-service

Gerçek zamanlı katman: Socket.io odaları, oda yetkisi ve kopyalar arası yayın (ADR-06). Gateway'den
ayrı bir süreçtir; REST ve gRPC sunmaz. Sözleşme: [`docs/api/socket-events.md`](../../docs/api/socket-events.md).

## Bugünkü durum (T12.1 + T12.2)

| Parça              | Durum                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Socket.io sunucusu | ✅ :3001, yalnızca websocket, istemci paketi en fazla 4 KB                                   |
| Oda modeli         | ✅ `order:{orderId}` (sahibi, jetonla), `store:{marketId}` (herkese açık) — `domain/room.ts` |
| Oda yetkisi        | ✅ `room.join` + gateway'in oda jetonu (HS256, ayrı sır) — `domain/room-access.ts`           |
| Redis adapter      | ✅ pub/sub; kopyalar odaları paylaşır (`MOCK=true`'da bellek, tek kopya)                     |
| Yayın kapısı       | ✅ `application/broadcast.ts` (şema + oda kuralı); bugün yalnızca testler kullanır           |
| Sağlık, metrik, iz | ✅ `GET /healthz` (:3001), `/metrics` (:4001), `room.join` span'i                            |
| İş olayı yayını    | ⏳ T12.3: `order.status` · #82: `reservation.*` · #83: `stock.changed`                       |

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
| `REDIS_URL`                   | Adapter'ın pub/sub bağlantıları (`MOCK=false`'ta zorunlu)                             |
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

## Metrikler

| Metrik                          | Etiketler                                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| `realtime_connections`          | —                                                                  |
| `realtime_room_joins_total`     | `room` (order, store, invalid), `outcome` (joined ya da hata kodu) |
| `realtime_events_emitted_total` | `event`                                                            |
| `realtime_events_dropped_total` | `event`                                                            |

## Kapanış

SIGTERM: sağlık 503 → Socket.io kapanır (istemciler "transport close" görür ve yeniden bağlanır) →
Redis bağlantıları → metrik ucu → izler. Her adım süreyle sınırlı.

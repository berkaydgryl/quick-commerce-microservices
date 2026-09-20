# quick-commerce-microservices

Quick-commerce (hızlı market) sipariş ve teslimat sisteminin çalışan dağıtık simülasyonu:
Go gateway + gRPC mikroservisler, Redis ile atomik stok rezervasyonu ve TTL, saga tabanlı
sipariş akışı, kural motoruyla risk skorlama, WebSocket üzerinden canlı kurye takibi.

> Eğitim amaçlı kişisel projedir; Getir ile herhangi bir ilişkisi yoktur.

## Durum

Kurulum sürüyor. Yol haritası: [`docs/roadmap.md`](docs/roadmap.md) (Gün 1 ile birlikte eklenecek).

| Faz | Kapsam | Gün |
| --- | --- | --- |
| Faz 1 | Sözleşmeler ve iskelet | 1-3 |
| Faz 2 | İş servisleri ve çekirdek risk | 4-7 |
| Faz 3 | Gateway ve stok motoru | 8-11 |
| Faz 4 | Gerçek zamanlı katman | 12-15 |
| Faz 5 | Tasarım, cila ve teslim | 16-20 |

## Teknoloji

Go 1.23+ (Fiber) · Node 22 + TypeScript 5 · gRPC + protobuf (buf) · MongoDB 7 (replica set) ·
Redis 7 (Lua, Streams) · Socket.io 4 · React 18 + Vite + TanStack Query + Zustand · Zod ·
Vitest + Testcontainers

Kurulum adımları, mimari şema ve demo senaryosu Gün 1 sonunda bu dosyaya eklenecek.

# apps/web

Müşteri arayüzü: React 18 + Vite + TypeScript. Tarayıcı yalnızca gateway ile konuşur (`/v1/*`).

## Bugünkü durum (T5.4 — market ekranları, tasarımsız kabuk)

| Parça                   | Durum                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Vite + React + router   | ✅ `/` ilk ekran · `/markets` yakındaki marketler · `/markets/:id` market sayfası                |
| TanStack Query          | ✅ Yalnızca geçici hata (`SERVICE_UNAVAILABLE`) yeniden denenir; mutasyon denenmez               |
| HTTP istemcisi          | ✅ Zarf açıcı → `AppError`; mutasyon `Idempotency-Key`'siz derlenmez (ADR-08)                    |
| Idempotency key         | ✅ `crypto.randomUUID()`, sözleşmedeki uzunluk sınırıyla                                         |
| Design token'lar        | ✅ `tokens.css`: marka paleti, Nunito, `clamp()` ölçeği, kapsayıcı genişlikleri                  |
| Kırılımlar              | ✅ `@custom-media` (48rem / 64rem), JS karşılığı `shared/config/breakpoints.ts`                  |
| Market veri hook'ları   | ✅ `useNearbyMarkets`, `useMarket`, `useMarketCategories`, `useMarketProducts` (imleçle sayfalı) |
| Ortak durumlar          | ✅ `QueryStatus`: yükleniyor / hata / boş; \"Tekrar dene\" yalnızca geçici hatada                |
| Zustand (sepet, oturum) | ⏳ İlgili web görevlerinde                                                                       |

## Market ekranları (T5.4) — tasarımsız kabuk

Ekranların **görsel tasarımı kullanıcının kararıdır** ve zamanı gelince yapılacak (T16.2). Bu görev
yalnızca veri katmanını ve okunur bir kabuğu kurar; yeni görsel karar yoktur, mevcut token'lar kullanılır.

- **Konum:** adres seçimi (T9.5) gelene kadar sabit "Ev" adresi (`features/markets/constants.ts`).
- **Ana sayfa değişmedi:** marketlere bağlantı bir tasarım kararı; şimdilik `/markets` adresiyle açılır.
- **Seçili kategori adreste** (`?kategori=`): yenileme ve paylaşma seçimi korur.
- **Stok gösterilmez:** `availableQuantity` bugün gelmiyor ("stok bilgisi yok"); sepet düğmeleri T6.4'te.
- **Olmayan market:** hata yalnızca başlıkta görünür, katalog tekrar etmez; `NOT_FOUND`'da "Tekrar dene"
  sunulmaz (aynı cevap döner).
- **Biçim** `shared/services/format.ts`'te: `4599` → `45,99 TL`, `1250` → `1,3 km`, `{15,25}` → `15-25 dk`.

## Çalıştırma

Üç süreç gerekir; her biri ayrı terminalde (PowerShell):

```powershell
# 1) catalog-service, Mongo'suz (bellek verisi)
pnpm --filter @getir/catalog-service build; $env:MOCK="true"; pnpm --filter @getir/catalog-service start

# 2) gateway (:8080) - gorsel adresleri web'in kokune gore kurulur
cd apps/gateway; $env:ASSET_BASE_URL="http://localhost:5173"; go run ./cmd/gateway

# 3) web (:5173)
pnpm --filter @getir/web dev
```

`http://localhost:5173` açılır. Vite `/v1` ve `/healthz` isteklerini gateway'e **proxy**'ler:
tarayıcı aynı kaynakla konuşur, gateway'de CORS gerekmez. Gateway başka adresteyse
`apps/web/.env` içine `GATEWAY_URL=...` yazılır (bkz. `.env.example`).

## Klasörler

```text
src/
  app/        router, QueryClient, sağlayıcılar
  pages/      rota başına sayfa kabuğu
  features/   özellik başına api + hook + ui (bugün: catalog)
  shared/
    api/      http-client (gönder), envelope (zarf aç), idempotency-key, client (örnek)
    config/   env.ts (import.meta.env yalnız burada), constants.ts, breakpoints.ts
    styles/   tokens.css, breakpoints.css, global.css (yalnız reset + tipografi)
    ui/       paylaşılan bileşenler (Logo, PageContainer)
    shims/    node-crypto.ts (aşağıda)
```

## Bilinen borç: `node:crypto` takma adı

`@getir/core/src/id.ts` `node:crypto`'dan `randomUUID` alır. Web `@getir/contracts`'ı,
o da core'u import ettiği için bu satır tarayıcı paketine girer ve Rollup çözemez.
`vite.config.ts` bu importu `src/shared/shims/node-crypto.ts`'e (Web Crypto) yönlendirir.
Kalıcı çözüm core'un `globalThis.crypto.randomUUID()` kullanmasıdır (Node 22'de de global);
o değişiklik platform alanında ayrı bir PR'dır ve yapıldığında takma ad silinir.

# apps/gateway

Tarayıcının konuştuğu **tek dış kapı** (Go + Fiber v3). Tarayıcı hiçbir gRPC servisine
doğrudan erişemez; REST isteği burada karşılanır, doğrulanır ve gRPC çağrısına çevrilir.

Pnpm workspace'inin parçası değildir: kendi Go modülüdür (`go.mod`). `pnpm verify` bu klasörü
kapsamaz; kapısı CI'daki **`gateway`** işidir (gofmt, vet, golangci-lint, `go mod tidy -diff`,
`-race` testleri, Mongo ve Redis entegrasyon testleri, statik derleme).

## Bugünkü durum (D8 — Go kuralları CI'da; T7.5 — sipariş uçları; T8.1 — kimlik; T8.2 — tekrar koruması ve hız sınırı; T8.3 — panik kurtarma ve zarf taraması; T8.4 — ürün listesinde stok; T9.6 — genel arama; T9.5 — adres defteri; T11.6 — karşılama ekranı içeriği; pazaryeri uçları T8.4'ten öne alındı)

| Parça                | Durum                                                           |
| -------------------- | --------------------------------------------------------------- |
| Env doğrulaması      | ✅ Açılışta, hatalar toplu raporlanır; geçersizse çıkış kodu 1  |
| gRPC istemci havuzu  | ✅ catalog + inventory + order, tembel bağlantı, keepalive      |
| `GET /healthz`       | ✅ Servisleri (ve MOCK değilse Mongo ile Redis'i) paralel sorgular; hepsi ayaktaysa 200, değilse 503 |
| Cevap zarfı          | ✅ `packages/contracts` ile aynı biçim, her cevapta `requestId`; bütün rotalar testle taranır (T8.3) |
| Panik kurtarma       | ✅ Uçtaki panik 500 `INTERNAL` zarfı, süreç ayakta; yığın izi yalnızca günlükte (T8.3) |
| Korelasyon kimliği   | ✅ `req_` + 32 hex; gelen kimlik yalnızca bu biçimdeyse korunur (D8) |
| Zarif kapanış        | ✅ SIGINT/SIGTERM → devam eden istekler beklenir                |
| `GET /v1/categories` | ✅ catalog `ListCategories`; bilinmeyen sorgu parametresi 400   |
| `GET /v1/content/welcome` | ✅ Ekran metin ve görselleri: karşılama (T11.6; T11.7'de indirme bandı ve tanıtım kutuları), adres penceresi (T11.8), şifre yenileme (T11.9), üst bar (T11.10): gömülü `internal/content/welcome.json`; açılışta doğrulanır, bozuksa gateway açılmaz; görseller `ASSET_BASE_URL` ile, mağaza bağlantıları yalnızca `https` ve olduğu gibi |
| `GET /v1/markets?lat&lng` | ✅ Yakındaki marketler; boş bölge = boş liste, hata değil |
| `GET /v1/markets/{id}` | ✅ Market sayfası başlığı; puan onda birden ondalığa (`47` → `4.7`) |
| `GET /v1/markets/{id}/categories` | ✅ Marketin teklifi olan kategoriler |
| `GET /v1/markets/{id}/products` | ✅ `categoryId`, `q`, `pageToken`, `pageSize`; her üründe `availableQuantity` (T8.4, aşağıda); `isActive` (T7.6) |
| `GET /v1/search?lat&lng&q` | ✅ Genel arama (T9.6): yakındaki marketlerde ürün ya da market adı; mesafe sırası, kapalılar sonda; market başına ilk 3 ürün + toplam; stok market başına, paralel |
| `POST /v1/cart/reserve` | ✅ order `CreateDraftOrder` (T7.5): taslak, fiyat sunucuda; stok kilitlenir (T11.2); cevapta `expiresAt` ve sunucunun saatiyle `ttlSeconds` (T11.4) |
| `DELETE /v1/cart/reserve/{orderId}` | ✅ order `CancelOrder` (T11.4): taslağı ya da ödeme bekleyen siparişi bırakır, stok döner; zaten bırakılmışsa 200 `released:false`; parası alınmışsa 409 `REQUEST_IN_PROGRESS`; başkasının siparişi 404 |
| `POST /v1/orders`    | ✅ order `CreateOrder` (saga): 201 `PAID` ya da `AWAITING_PAYMENT` + `threeDs` |
| `POST /v1/orders/{id}/3ds` | ✅ order `ConfirmPayment`; yanlış kod 402 + kalan hak |
| `GET /v1/orders/{id}` | ✅ order `GetOrder`; başkasının siparişi 404; kilit canlıyken `reservationExpiresAt` ve `reservationTtlSeconds` (T11.4) |
| `POST /v1/auth/register` | ✅ Kayıt + oturum (201); telefon benzersiz, şifre bcrypt (T8.1) |
| `POST /v1/auth/login` | ✅ Giriş (200); yanlış şifre ile kayıtsız numara aynı cevabı alır |
| `POST /v1/auth/password-reset` | ✅ Demo şifre yenileme (T11.9): telefon + yeni şifre, kod yok; eski oturumlar kapanır, yeni oturum açılır. **Yalnızca `NODE_ENV` production değilken bağlanır**; IP başına kimlik sınırı, anahtar istemez |
| `POST /v1/auth/phone-check` | ✅ Numarayla kayıtlı hesap var mı (T11.7): karşılama pencereleri erken uyarır. Bilinçli ödünleşim: numaranın kayıtlı olduğu öğrenilebilir; IP başına kimlik sınırı (ayrı sayaç), numara günlüğe yazılmaz, anahtar istemez |
| `POST /v1/auth/refresh` | ✅ Yenileme jetonu her kullanımda değişir; eskisi bir daha geçmez |
| `POST /v1/auth/logout` | ✅ Yenileme jetonunu iptal eder; tekrarı zararsız (`revoked:false`) |
| `GET /v1/me`         | ✅ Jetondaki kullanıcının profili |
| `GET /v1/me/addresses` | ✅ Adres defteri (T9.5): kayıtlı adresler, kayıt sırasında; en fazla 10 (sınırlı liste); önbelleğe alınmaz |
| `POST /v1/me/addresses` | ✅ Adres ekleme (T11.8): tür, bina/kat/daire, tarif; aynı ad ve 11. adres tek atomik Mongo yazımında reddedilir; `Idempotency-Key` ister, cevap güncel defter |
| `GET /v1/geo/reverse?lat&lng`, `GET /v1/geo/search?q` | ✅ Harita adres servisi (T11.8, `internal/geo`): OpenStreetMap Nominatim'e **tek sıra** (saniyede en fazla bir istek, kullanım koşulu) ve 24 saat önbellekle; sıra `GEO_TIMEOUT_MS` içinde ilerlemezse 503, adres yoksa 404. Oturum ister |
| Kullanıcı kimliği    | ✅ `Authorization: Bearer` JWT (HS256); `X-User-Id` kalktı (T8.1) |
| Kimlik deposu        | ✅ Mongo `users` + `sessions` (TTL indeksi); MOCK'ta bellek |
| Sipariş risk sinyalleri | ✅ `CheckoutSignals`'ın 7 alanı oturum ve kullanıcı kaydından (T8.1); cihaz çerezi `getir_device` |
| Demo personaları     | ✅ Ayşe, Zeynep, Can, Ali, Komşu (`pnpm seed:personas`; MOCK'ta açılışta bellekte) |
| Idempotency-Key      | ✅ Zorunlu; tekrar koruması (T8.2): aynı anahtar ilk cevabı alır, eş zamanlısı 409; Redis, MOCK'ta bellek |
| gRPC hata çevirisi   | ✅ `x-app-error` trailer'ı, yoksa durum kodu (`apperror`)       |
| Görsel adresleri     | ✅ Göreli yol → mutlak URL (`ASSET_BASE_URL`, `internal/assets`) |
| Stok birleştirmesi (B27) | ✅ Sayfa başına tek `CheckAvailability` (T8.4); genel aramada market başına bir, hepsi paralel (T9.6); stok servisi 300 ms'de cevap vermezse ürünler stoksuz döner |
| Rate limit           | ✅ Kayan pencere, Redis'te (T8.2); uç başına; IP ya da kullanıcı; 429 + `Retry-After` |
| Go kuralları         | ✅ CI'da golangci-lint: `errcheck`, `noctx`, `bodyclose` (D8)    |

## Çalıştırma

Gateway, `packages/proto`'nun **üretilen** Go koduna `replace` ile bağlıdır ve `gen/` depoda
yoktur. İlk derlemeden (ve her `.proto` değişikliğinden) önce Go kodu üretilmelidir:

```bash
pnpm proto:gen                       # TS + Go (Go icin buf + protoc eklentileri gerekir)
cd apps/gateway
# ASSET_BASE_URL ve JWT_SECRET zorunlu. MOCK=true: hesaplar ve tekrar kayitlari bellekte
# (Mongo ve Redis gerekmez).
ASSET_BASE_URL=http://localhost:5173 JWT_SECRET="$(openssl rand -hex 32)" MOCK=true go run ./cmd/gateway
# Hesaplar Mongo'da, tekrar kayitlari Redis'te kalsin (docker compose'daki Mongo ve Redis).
# Gateway'in kendi Mongo kullanicisi (D14): kok .env'deki GATEWAY_MONGO_URI ile ayni.
ASSET_BASE_URL=http://localhost:5173 JWT_SECRET="$(openssl rand -hex 32)" \
  GATEWAY_MONGO_URI='mongodb://gateway:gateway-dev-only@localhost:27017/?directConnection=true&authSource=admin' \
  REDIS_URL=redis://localhost:6379 go run ./cmd/gateway
curl -s localhost:8080/v1/categories | jq
curl -s localhost:8080/healthz | jq
go test -race ./...
# Mongo depolari, Redis tekrar deposu ve hiz siniri sayaci; Docker gerekir (Testcontainers):
go test -tags integration ./internal/authstore/ ./internal/idempotency/ ./internal/ratelimit/
```

`JWT_SECRET` her açılışta yeniden üretilirse önceki jetonlar geçersiz olur (kullanıcı yeniden
giriş yapar). Kalıcı bir değer için `.env`'e bir kez yazın; `.env.example`'daki örnek değer
production'da reddedilir.

Go kuralları (CI'daki golangci-lint ile aynı sürüm; Docker yeter, kurulum gerekmez):

```bash
# depo kokunden
docker run --rm -v "$PWD":/src:ro -w /src/apps/gateway golangci/golangci-lint:v2.14.0 golangci-lint run
```

Docker (build bağlamı **depo köküdür**):

```bash
docker build -f apps/gateway/Dockerfile -t getir/gateway .
docker run --rm -p 8080:8080 \
  -e ASSET_BASE_URL=http://localhost:5173 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e GATEWAY_MONGO_URI='mongodb://gateway:gateway-dev-only@host.docker.internal:27017/?directConnection=true&authSource=admin' \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e CATALOG_GRPC_ADDR=host.docker.internal:50051 \
  -e INVENTORY_GRPC_ADDR=host.docker.internal:50052 \
  -e ORDER_GRPC_ADDR=host.docker.internal:50053 \
  getir/gateway
```

İmaj `distroless/static:nonroot` üzerindedir (~28 MB). İçinde kabuk olmadığı için Docker
`HEALTHCHECK`'i ikilinin kendi alt komutunu çağırır: `/gateway healthcheck`. Komut 2 sn son
tarihli bir bağlamla `/healthz`'i sorar; sağlıksızsa sebebi stderr'e yazar, Docker onu sağlık
kaydında saklar (`docker inspect`).

## Korelasyon kimliği (`X-Request-ID`)

Her isteğin bir kimliği vardır ve aynı değer dört yerde görünür: cevap başlığı
(`X-Request-ID`), hata zarfı (`error.requestId`), gateway günlüğü (`requestId`) ve servise giden
gRPC metadata'sı (`x-request-id`). Böylece tek istek gateway'den servise kadar günlükte izlenir.

- **Biçim:** `req_` + 32 küçük onaltılık karakter; Node servisleriyle aynı
  (`@getir/core` `id.ts`).
- **Gelen kimlik** yalnızca bu biçimdeyse korunur; biçim dışı değer (serbest metin, çok uzun
  dizi) yok sayılır ve yenisi üretilir (D8). Başlık istemcinin elindedir ve kabul edilen değer
  her servisin günlüğüne yazılır.
- `/healthz` de kimliği servislere taşır.
- **Sunucu düzeyindeki hata** (64 KB gövde sınırı, zaman aşımı): Fiber önce ara katmanları rota
  işleyicisi olmadan çalıştırır, cevabı sonra hata işleyici yazar. İstek satırı (`http istegi`) bu
  yüzden hata işleyicide, cevabın son durumuyla yazılır (T8.3; önceden 200 yazıyordu, canlı testte
  bulundu). Ara katmanlar hiç çalışmadan gelen hatada kimlik hata işleyicide üretilir; hata cevabı
  yine kimliksiz kalmaz.

## İzler (D15, ADR-20)

Her HTTP isteği bir sunucu span'i, giden her gRPC çağrısı bir istemci span'i açar; `traceparent`
servise gRPC metadata'sıyla gider ve Node servislerinin span'leri aynı izde görünür. İzler
`OTEL_EXPORTER_OTLP_ENDPOINT`'e (OTLP/HTTP, yerelde Jaeger: http://localhost:16686) gönderilir;
adres yoksa span'ler yine oluşur ve taşınır, yalnızca dışarı gönderilmez.

- **Kurulum** `internal/telemetry`: sağlayıcı, W3C yayıcı, OpenTelemetry hatalarının JSON günlüğe
  (dakikada en çok bir WARN) yönlendirilmesi. Küresel OpenTelemetry durumu yalnızca `main`'de kurulur;
  paketler izleyiciyi parametre alır, testler küresel duruma dokunmaz.
- **İstek span'i** (`internal/httpapi/tracing.go`): istek kimliğinden sonra, istek günlüğünden önce.
  Ad rota kalıbı (`POST /v1/orders`; eşleşmeyen yolda yalnızca yöntem). Nitelikler **izin
  listelidir**: yöntem, rota, yol, durum kodu, `app.request_id`, hata varsa `app.error_code`.
  **Sorgu dizesi (konum, arama metni), istemci IP'si ve kullanıcı ajanı yazılmaz.** Resmî Fiber ara
  katmanı sorguyu ve tam adresi her zaman yazdığı için kullanılmadı. 5xx hata sayılır, 4xx sayılmaz.
  Fiber'in yönlendirme öncesi hata geçişinde (gövde sınırı) span da istek satırı gibi bekletilir ve
  hata işleyici cevabı yazdıktan sonra son durumla kapanır.
- **İstemci span'i** (`internal/rpc/tracing.go`, havuzdaki her bağlantıda): yalnızca sistem tarafı
  kodlar (Unavailable, DeadlineExceeded, Internal, Unimplemented, Unknown, DataLoss, Canceled) hata
  işaretlenir; iş sonucu (FailedPrecondition, NotFound...) işaretlenmez. Node'daki ağırlık tablosuyla
  aynı karar (otelgrpc OK dışı her kodu hata sayar, bu yüzden kullanılmadı).
- **Günlük:** istek kapsamındaki satırlar (`InfoContext`, `WarnContext`...) span'in `traceId` ve
  `spanId`'sini taşır (`telemetry.NewLogHandler`).
- **Kapanış:** sunucu ve bağlantılar kapandıktan sonra bekleyen span'ler en çok 2 sn'de gönderilir.

## Metrikler (#29)

Gateway `GATEWAY_PORT + 1000`'de (yerelde 9080) **yalnızca `GET /metrics`** sunar; `/metrics`'e başka
fiil 405 (`Allow: GET`), başka yol 404. Ayrı porttadır: istemcilere açık API portu metrik göstermez.
Kurallar Node servisleriyle aynıdır (T10.5): ad öneki yok, her metrikte `service="gateway"`, birim
adın sonunda, etiket değeri **kapalı kümeden**. Kimlik, IP, sorgu ve ham yol etiket olmaz.

| Metrik                                                  | Ne                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `http_server_requests_total{route,method,code}`         | Tamamlanan istek; `code` `OK` ya da hata sözlüğü kodu (`RATE_LIMITED`, `NOT_FOUND`…) |
| `http_server_request_duration_seconds{route,method,code}` | İsteğin gateway'deki süresi (servis çağrıları dahil); kovalar 5 ms - 10 sn (Node'la aynı) |
| `idempotency_replays_total{route}`                      | Kayıttan aynen tekrar edilen cevap (`Idempotent-Replayed: true`)                      |
| `idempotency_key_rejections_total{route,reason}`        | Anahtar yüzünden 409: `key_reused` (farklı gövde), `in_progress`, `replay_unavailable` |
| `rate_limit_rejections_total{route}`                    | Hız sınırına takılan istek (429); rota hangi sınır olduğunu da söyler                 |
| `go_*`, `process_*`                                     | Go çalışma zamanı ve süreç (bellek, CPU, goroutine)                                   |

- `route` rota kalıbıdır (`/v1/orders/:id`); eşleşmeyen yol `unmatched`, kullanılmayan yöntem
  (`TRACE`, `CONNECT`) `OTHER`. `/healthz` de sayılır (yoklama sıklığı görünür). Fiber'in yönlendirme
  öncesi hata geçişindeki istek (gövde sınırı) son durumla bir kez sayılır.
- Kayıt `internal/httpapi/metrics.go` (ara katman, `RequestMetrics` arayüzü), defter ve uç
  `internal/metrics` (`prometheus/client_golang`; defter örneğe ait, küresel değil).
- Kapanış Node'la aynı sıradadır: HTTP drenajından sonra metrik ucu kapanır (süren kazıma en çok 1 sn
  beklenir), sonra bağlantılar, en son izler.

```bash
curl -s localhost:9080/metrics | grep -E '^(http_server|idempotency|rate_limit)'
```

## Go kuralları ve lint (D8)

Kuralların kendisi `.cursor/rules/proje-kurallari.mdc` "Go" bölümündedir; CI onları
golangci-lint ile denetler (`.golangci.yml`, yalnızca kuralı olan üç denetleyici):

| Denetleyici | Kural |
| ----------- | ----- |
| `errcheck` (`check-blank`) | Hata yutulmaz; `_ = f()` ve `v, _ := f()` de bulgudur |
| `noctx` | Ağ çağrısı `context` alır (testlerde `t.Context()`) |
| `bodyclose` | HTTP cevap gövdesi kapatılır |

Gerçekten gerekçeli bir istisna satırında yazılır: `//nolint:errcheck // <gerekçe>`;
gerekçesiz `nolint` de bulgudur. Entegrasyon testleri (`//go:build integration`) de denetlenir:
`.golangci.yml`'de `run.build-tags`, CI'daki `go vet`'te `-tags integration`. Birden fazla paketin testinde gereken yardımcılar
(`BufconnClient`, `AppErrorOf`, `JSON`) `internal/testkit`'tedir; üretim kodu bu paketi
kullanmaz.

`bodyclose`, gövdenin kapatıldığını yalnızca cevabın verildiği fonksiyonun **kendi**
gövdesinde görür. Bu yüzden test yardımcısı `decode` gövdeyi doğrudan kapatır ve yardımcılar
`*http.Response` döndürmez, durum kodu ve zarf döndürür.

## Kimlik (T8.1)

Kimlik telefon + şifreyle kurulur (ADR-12); `users` ve `sessions` koleksiyonlarının sahibi
gateway'dir (ADR-05). Katmanlar: `internal/auth` (use-case'ler, kurallar, jeton; HTTP ve Mongo
bilmez), `internal/authstore` (Mongo ve bellek depoları), `internal/httpapi` (`auth.go`,
`identity.go`).

- **İki jeton:** erişim jetonu HS256 JWT'dir (`JWT_SECRET`, ömrü `JWT_TTL`); yalnızca kimlik
  taşır (`sub` kullanıcı, `sid` oturum, `iss`, `iat`, `exp`), telefon ya da ad taşımaz.
  Doğrulamada yalnızca HS256 kabul edilir (`alg: none` ve başka algoritmalar reddedilir).
  Yenileme jetonu 256 bit rastgele, opak bir metindir; sunucuda yalnızca **SHA-256 özeti**
  saklanır.
- **Yenileme jetonu çerezde, gövdede değil** (`refresh_cookie.go`): kayıt, giriş ve yenileme
  jetonu `getir_refresh` çerezine yazar: HttpOnly (sayfadaki betik okuyamaz, XSS çalamaz),
  `SameSite=Strict` (başka siteden gelen istek taşımaz), `Path=/v1/auth` (yalnızca kimlik uçlarına
  gider), ömrü `REFRESH_TTL`, production'da `Secure`. `/v1/auth/refresh` ve `/v1/auth/logout`
  gövdesizdir, jetonu çerezden okur. Çerezsiz yenileme `401` (`getir_refresh: zorunlu`);
  kullanılamayan jetonun çerezi ve çıkışta çerez silinir. İstemci erişim jetonunu bellekte tutar,
  sayfa yenilenince `/v1/auth/refresh`'i çağırır (ADR-12 eki).
- **Yenileme döner:** her `/v1/auth/refresh` jetonu yenisiyle değiştirir (tek atomik Mongo
  güncellemesi); eski jeton bir daha geçmez, aynı jetonla eş zamanlı iki istekten yalnızca biri
  kazanır. Süre son kullanımdan itibaren `REFRESH_TTL`'dir; süresi dolan kayıt TTL indeksiyle
  silinir, silinmeden önce de yenilenmez.
- **Şifre:** bcrypt, maliyet 12. Üst sınır **72 bayt** (bcrypt'in kullandığı kadar; Türkçe
  harfler iki bayt), alt sınır 8 karakter. Kurallar `@getir/contracts` ile aynıdır ve
  `rules_contract_test.go` iki tarafı karşılaştırır.
- **Tarama koruması:** yanlış şifre ile kayıtsız numara aynı cevabı alır
  (`401 INVALID_CREDENTIALS`, ayrıntısız); kayıtsız numarada da bcrypt çalışır, süre de ele
  vermez.
- **Korumalı uç:** `Authorization: Bearer <jeton>` (şema büyük-küçük harfe duyarsız). Yoksa ya
  da geçersizse `401 UNAUTHORIZED` + `WWW-Authenticate` döner; handler ve servis hiç çağrılmaz.
- **Önbellek ve günlük:** jeton ya da profil taşıyan cevaplar `Cache-Control: no-store` ile
  gelir. Şifre ve jetonlar günlüğe yazılmaz (testle sabit); `JWT_SECRET` `config.Secret`
  tipindedir, yanlışlıkla yazdırılsa bile `[gizli]` görünür.
- **Depo seçimi:** `MOCK=true` ise hesaplar bellekte tutulur ve Mongo'ya hiç gidilmez (Node
  servisleriyle aynı kural; süreç kapanınca hesaplar gider). Değilse `GATEWAY_MONGO_URI` zorunludur
  (gateway'in kendi Mongo kullanıcısı, yalnızca kendi veritabanında `getir_gateway` yetkili; D14),
  açılışta ping atılır ve indeksler kurulur (`users.phone` benzersiz; `sessions.tokenHash`
  benzersiz, `sessions.expiresAt` TTL, `sessions.userId`). Mongo işlemleri de
  `GATEWAY_REQUEST_TIMEOUT_MS` ile sınırlıdır.
- **Bilinen sınırlar:** çıkıştan sonra erişim jetonu süresi (≤ `JWT_TTL`) dolana kadar geçerli
  kalır (durumsuz jetonun bedeli); yalnızca sipariş kapanır (aşağıda). Cevabı kaybolan
  yenilemede eski jeton harcanmış olur ve yeniden giriş gerekir. Giriş denemesi IP başına sınırlıdır
  (dakikada 10; "Hız sınırı"). Kayıt ucunun tekrar kuralı aşağıda ("Tekrar koruması").

```bash
# Cerezler (cihaz + yenileme) curl'un cerez kavanozunda tutulur: -c yazar, -b gonderir.
curl -s -c /tmp/getir-cerez -b /tmp/getir-cerez localhost:8080/v1/auth/register -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: kayit-0001' -d '{"phone":"+905321234567","password":"Gizli-Parola-2026","fullName":"Ayse Yilmaz"}' | jq
TOKEN="$(curl -s -c /tmp/getir-cerez -b /tmp/getir-cerez localhost:8080/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"phone":"+905321234567","password":"Gizli-Parola-2026"}' | jq -r .data.accessToken)"
curl -s localhost:8080/v1/me -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST -c /tmp/getir-cerez -b /tmp/getir-cerez localhost:8080/v1/auth/refresh | jq   # yeni erisim jetonu
curl -s -X POST -c /tmp/getir-cerez -b /tmp/getir-cerez localhost:8080/v1/auth/logout | jq    # revoked: true
```

## Tekrar koruması (`Idempotency-Key`, T8.2)

Yazan uçlar (`POST /v1/auth/register`, `/v1/cart/reserve`, `DELETE /v1/cart/reserve/{orderId}` (T11.4),
`/v1/orders`, `/v1/orders/{id}/3ds`, `POST /v1/me/addresses`) aynı niyetin ikinci kez işlenmesine karşı korunur
(ADR-08 ve T8.2 eki).
Katmanlar: `internal/idempotency` (kayıt deposu: Redis ve bellek; HTTP bilmez),
`internal/httpapi/idempotency.go` (ara katman: ne saklanır, ne tekrar edilir),
`internal/redisdb` (bağlantı, `/healthz` pingi, sürücü günlüğünün JSON'a yönlendirilmesi).

| Durum                                   | Cevap                                                        |
| --------------------------------------- | ------------------------------------------------------------ |
| Anahtar yok                             | 400 `Idempotency-Key: zorunlu` (gövde hatalarıyla tek cevapta) |
| Anahtar biçimsiz (8-128; harf, rakam, `-`, `_`) | 400 VALIDATION_FAILED                                |
| İlk istek                               | Uç çalışır; cevap kaydedilir                                 |
| Aynı istek, ilki hâlâ işleniyor         | 409 REQUEST_IN_PROGRESS (çift tıklama, B6)                   |
| Aynı istek, ilki bitmiş                 | İlk cevap aynen + `Idempotent-Replayed: true`; uç çalışmaz   |
| Aynı anahtar, farklı istek              | 409 CONFLICT                                                 |
| Redis'e ulaşılamıyor                    | 503 SERVICE_UNAVAILABLE (korumasız sipariş alınmaz)          |

- **Kayıt:** `idem:{usr_…}:<anahtar>` (kullanıcı başına; kayıt ucunda `idem:{anon}:…`). Biçim
  `@getir/redis-kit` `idempotencyKey`'dedir; `keys_contract_test.go` karşılaştırır. Anahtar
  kuralı `@getir/core`'dadır; `idempotency_contract_test.go` karşılaştırır.
- **Atomiklik:** `SET NX PX 30000` ile "işleniyor" alınır (sahibin jetonu ve isteğin parmak
  izi: yöntem + yol + gövde, JWT sırrından türetilen anahtarla HMAC). Bitirme ve bırakma Lua
  ile yalnızca aynı jeton hâlâ sahipse yazar. Korunan ucun bütün işi 25 sn'lik bir son
  tarihle çalışır: "işleniyor" kaydı (30 sn) iş sürerken düşmez.
- **Saklanan:** durum kodu + cevap gövdesi (en fazla 16 KB). 5xx, 400, 401 ve 429 saklanmaz;
  anahtar bırakılır, istemci aynı anahtarla yeniden dener. İş kuralı hataları (402, 403, 404,
  409, 422) saklanır ve tekrar edilir.
- **Ömür:** başarılı sipariş ve 3DS kaydı 2 saat; diğerleri `IDEMPOTENCY_TTL_SECONDS`
  (24 saat); "işleniyor" 30 sn.
- **Kayıt ucu istisnası:** cevap jeton taşır, jeton Redis'e yazılmaz. Biten kaydın aynı
  anahtarla tekrarı uca geçer ve 409 PHONE_ALREADY_REGISTERED alır.
- **3DS:** her kod denemesi yeni bir anahtarla gönderilir; aynı anahtarla farklı kod 409
  CONFLICT alır.
- **Süre:** her Redis komutu `GATEWAY_REQUEST_TIMEOUT_MS` ile sınırlıdır ve sürücü tarafından
  yeniden denenmez (yeniden denemeyi istemci aynı anahtarla yapar); Redis takılırsa istek bu
  sürede 503 alır. Sürücünün kendi günlük satırları da JSON'dur (`"msg":"redis surucusu"`).
- **MOCK=true:** kayıtlar bellekte (aynı kurallar); Redis'e gidilmez, `/healthz`'de `redis`
  kalemi yoktur.

```bash
# TOKEN: "Kimlik" bolumundeki giris komutundan. Ayni anahtarla iki istek: ikisi de ayni
# orderId'yi alir, taslak bir kez acilir; ikinci cevap "Idempotent-Replayed: true" tasir.
for i in 1 2; do curl -s -i localhost:8080/v1/cart/reserve -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: taslak-0002' -d '{
  "marketId":"mkt_migros-jet-moda",
  "items":[{"productId":"prd_bulasik-deterjan","quantity":2},{"productId":"prd_cikolata-80","quantity":1}],
  "address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},
  "expectedTotal":{"amountMinor":19360,"currency":"TRY"}}' | grep -iE '^idempotent|orderId'; done
```

## Hız sınırı (T8.2, roadmap P2)

Sayaç **kayan pencere günlüğüdür** (sliding window log): kabul edilen her istek zamanıyla Redis
sorted set'ine yazılır; pencereden çıkanlar atılır, kalanlar sayılır. Üçü tek Lua betiğinde
(`internal/ratelimit/redis.go`): arada başka istemci giremez. Sabit pencerenin aksine sınır anında
patlama olmaz. Sayaç Redis'te olduğu için birden fazla gateway örneği **aynı sınırı** paylaşır;
bellek içi sayaç sınırı örnek sayısı kadar gevşetirdi (proje kuralları).

| Uçlar                                                    | Sınır (pencere başına)           | Kim sayılır |
| -------------------------------------------------------- | -------------------------------- | ----------- |
| `POST /v1/auth/register`, `/login`, `/phone-check`, `/password-reset` | `RATE_LIMIT_AUTH_MAX_REQUESTS` (10) | IP          |
| `POST /v1/auth/refresh`, `/v1/auth/logout` (T8.5)         | `RATE_LIMIT_MAX_REQUESTS` (120)  | IP          |
| `POST`/`DELETE /v1/cart/reserve`, `/v1/orders`, `/v1/orders/{id}/3ds` | `RATE_LIMIT_ORDER_MAX_REQUESTS` (20) | kullanıcı   |
| Katalog, market ve genel arama uçları                     | `RATE_LIMIT_MAX_REQUESTS` (120)  | IP          |
| `GET /v1/me`, `/v1/me/addresses`, `GET /v1/orders/{id}`   | `RATE_LIMIT_MAX_REQUESTS` (120)  | kullanıcı   |
| `POST /v1/me/addresses`, `/v1/geo/*` (T11.8)               | `RATE_LIMIT_MAX_REQUESTS` (120)  | kullanıcı   |
| `/healthz`                                                | sınırsız                         | —           |

- **Anahtar:** `rate:{ozne}:POST_/v1/orders/id/3ds` (`@getir/redis-kit` `rateLimitKey`;
  `keys_contract_test.go` karşılaştırır). Sayım **uç başınadır**; yol kalıbı kullanılır, gerçek yol
  değil (her sipariş kimliği ayrı sayaç açmaz). Anahtarın ömrü pencere kadardır.
- **Yenileme ve çıkış genel sınırda (T8.5):** web her sayfa açılışında oturumu sessizce yeniler;
  yenileme jetonu 256 bit rastgele olduğu için kaba kuvvet sınırına gerek yok. Dar sınır (10) yalnızca
  tahmin edilebilir girdisi olan kayıt ve giriştedir.
- **Kim sayılır:** kimliksiz uçlarda soketin IP'si (`X-Forwarded-For`'a güvenilmez, B9); kimlik
  isteyen uçlarda kullanıcı: aynı ağın (ofis, mobil operatör) arkasındaki kullanıcılar birbirinin
  sınırını tüketmez. Korumalı uçta sınırlayıcı kimlikten SONRA, tekrar korumasından ÖNCE çalışır:
  429 alan isteğin `Idempotency-Key`'i alınmaz.
- **Yalnızca kabul edilen istek sayılır:** sayaç sınırı hiç aşmaz (saldırı altında Redis büyümez).
  Beklemeden yeniden denemek süreyi uzatmaz; `Retry-After` kadar beklemek yeter.
- **Saat Redis'in** (`TIME`, betik içinde): örnekler arası saat farkı pencere sınırında sayımı
  kaydıramaz.
- **Cevap:** `429 RATE_LIMITED`, `Retry-After` (tam saniye, yukarı yuvarlanır) ve
  `details.retryAfterSeconds`.
- **Redis yoksa istek geçer (fail-open):** hız sınırı bir kesintide siparişi durdurmamalı; tekrar
  koruması ise durdurur (503, yukarıda). Sayaç en fazla 250 ms beklenir: Redis takılırsa (cevap
  vermezse) okuma uçları istek süresinin tamamı kadar değil, bu kadar gecikir. Uyarı en fazla 10 sn'de
  bir yazılır (`"msg":"hiz siniri uygulanamadi, istek gecirildi (fail-open)"`).
- **Kapatma ve MOCK:** `RATE_LIMIT_ENABLED=false` sınırı kapatır (yük testleri). `MOCK=true`'da sayaç
  bellektedir (aynı kurallar, yalnızca tek örnek).
- **Bilinen sınırlar:** yük dengeleyici arkasında gerçek istemci IP'si okunmaz (güvenilir vekil
  ayarı yok; bugün yerel). Tek hesaba çok IP'den giriş denemesinin (telefon başına) sınırı yok.

```bash
# Giris siniri (10/dk, IP basina): 11. istek 429 ve Retry-After alir.
for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"phone":"+905321234567","password":"yanlis-sifre"}'; done; echo
curl -s -i localhost:8080/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"phone":"+905321234567","password":"yanlis-sifre"}' | grep -iE '^retry-after|RATE_LIMITED'
```

## Sipariş risk sinyalleri (T8.1)

`POST /v1/orders` order-service'e `CheckoutSignals`'ı (7 alan) gönderir; hiçbiri istemcinin
beyanından gelmez (B9). Okuyan tek yer `auth.Service.CheckoutSignals`; biçim doğrulamasından
**sonra** okunur (biçimsiz istek veritabanına gitmez).

| Alan | Kaynak |
| ---- | ------ |
| `ip_address` | İsteğin bağlantısı (`c.IP()`; `X-Forwarded-For` okunmaz) |
| `device_id` | Oturumun açıldığı cihaz: gateway'in verdiği `getir_device` çerezi (`dvc_` + 32 hex; HttpOnly, SameSite=Lax, 1 yıl, production'da Secure). Kayıt ve girişte verilir; biçim dışı değer yok sayılır, yenisi üretilir |
| `accounts_on_device` | Hesabın **açıldığı** cihazdan açılmış hesap sayısı (`users.registrationDeviceId`). Girişler sayılmaz: aynı tarayıcıdan başka hesaplara girmek (aile, demo personaları) sayıyı artırmaz; aynı cihazdan açılan her hesap artırır. 3+ risk-svc'de kesin kural (veto). Cihazı bilinmeyen eski hesapta 0 = ölçülmedi |
| `previous_ip_address` | Kullanıcının bir önceki girişinin IP'si (girişte `users.lastLoginIp`'den oturuma yazılır; tek atomik güncelleme). İlk oturumda boş |
| `session_location`, `ip_city` | IP'den konum çözücü (`auth.Locator`); yerelde/MOCK'ta çözücü yok (GeoIP bekleyen iş). Çözülemezse oturum kullanıcının **son bilinen** konumunu devralır, şehir boş kalır; hiç bilinmiyorsa gönderilmez ve geofence tetiklenmez |
| `account_created_at` | `users.createdAt` |

Oturumu kapanmış (çıkış yapılmış ya da süresi dolmuş) jetonla sipariş verilemez: 401
`UNAUTHORIZED` (`details.Authorization`). Jeton süresince profil okunabilir; kapanan
oturumla sinyalleri silip sipariş vermek mümkün olmaz.

## Demo personaları (T8.1)

Risk bandlarının her biri için hazır hesap (roadmap "Test personaları"). Hesaplar ve gateway
sinyalleri `internal/persona` (`personas.json`, `addresses.json`), sipariş geçmişleri
order-service'te (ADR-05); iki taraf aynı kimlikleri kullanır ve bir test karşılaştırır.
**Yalnızca yerel/MOCK:** `NODE_ENV=production`'da seed de bellek yüklemesi de reddeder.

| Persona | Telefon | Beklenen band | Neden |
| ------- | ------- | ------------- | ----- |
| Ayşe | `+905550000001` | LOW → kart | 30 günlük hesap, 5 teslimat |
| Zeynep | `+905550000002` | MEDIUM → 3DS | 1 saatlik hesap, teslimat yok |
| Can | `+905550000003` | HIGH → inceleme | 10 saatlik, %75 iptal, Ankara'dan oturum; **sepet 360 TL'yi geçerse** sepet anomalisi |
| Ali | `+905550000004` | CRITICAL → 403 | Hesabının açıldığı cihazdan 4 hesap (veto), İzmir'den oturum |
| Komşu | `+905550000005` | LOW → kart | 90 günlük, 12 teslimat; stok yarışında ikinci tarayıcı |

**Hazır adresler** (`addresses.json`; adres defteri, T9.5): yukarıdaki beş personaya yüklenir; Ali'nin
cihazındaki diğer üç hesapta adres yoktur (boş defter: web'de "Kayıtlı adresin yok."). Her adresin demodaki
işlevi (hangi marketler hizmet verir, hangisi kapalı, hangisi boş bölge) tek yerde:
[`infra/seed/README.md`](../../infra/seed/README.md#adresler). Adresin `note` alanı kullanıcının **kurye
notudur** ("Zil çalışmıyor, gelince arayın."). Notlar 30 Eylül'e kadar demo açıklamalarını taşıyordu; adres
defteri ucu kullanıcıya açılınca (T9.5) kurye notuna çevrildi. Mongo'daki eski notlar `pnpm seed:personas`
ile yenilenir.

Demo şifresi hepsinde `Demo-Persona-2026` (herkese açık; gizli değil). Ali'nin cihazındaki diğer
üç hesap `+905550000014/24/34`. Zeynep ve Can "24 saatten yeni" olduğu için seed'den 24 saat
sonra bantları kayar: demo öncesi seed yeniden çalıştırılır (tekrarı güvenli). Ali'nin "hızlı
sipariş" sinyali (3 sn altı) ancak betikle gelir; elle denemede de veto yüzünden CRITICAL kalır.

```bash
pnpm seed:personas   # kokten: order-service gecmisi + gateway hesaplari, .env ile (Go gerekir)
# MOCK=true iken seed gerekmez: gateway ve order-service acilista bellege yukler.
```

## Sipariş uçları (T7.5)

Dört uç tek adaptörden (`internal/order`) order-service'e gider. Hepsi erişim jetonu ister
(yukarıda); yazan üçü `Idempotency-Key` ister. Kurallar (fiyat, risk, 3DS, durum geçişi)
order-service'tedir.

- **Kimlik:** kullanıcı yalnızca erişim jetonundan gelir (T8.1); T7.5'teki `X-User-Id`
  geliştirme başlığı kaldırıldı. Kimliği belirleyen tek yer `internal/httpapi/identity.go`.
- **Katı gövde:** JSON dışı içerik, bozuk JSON, bilinmeyen alan (ör. adres etiketi `title`) ve
  yanlış tip 400 döner; `details` alan adını taşır. Gövde sınırı 64 KB.
- **Gateway'in gördüğü yokluk:** iç içe nesneler (`address.location`, `expectedTotal`)
  gönderilmezse proto'ya da gönderilmez ve servis "zorunlu" der. Gönderilen konumda enlem ya da
  boylam **yoksa** (0 değil, yok) bunu yalnız gateway görür: 400.
- **Risk sinyali (B9):** `POST /v1/orders`'ta bağlantının IP'si `CheckoutSignals.ip_address`
  olarak order'a gider; istemcinin yazabildiği `X-Forwarded-For` okunmaz (güvenilir vekil yok).
- **Alan adları:** servisin proto yolu REST adına çevrilir: `lines.0.quantity` →
  `items.0.quantity`, `deliveryLocation.lat` → `address.location.lat`, `code` → `otp`,
  `idempotencyKey` → `Idempotency-Key`.

```bash
# TOKEN: yukaridaki giris komutundan. Basliklar her komutta acikca yazilir.
curl -s localhost:8080/v1/cart/reserve -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: taslak-0001' -d '{
  "marketId":"mkt_migros-jet-moda",
  "items":[{"productId":"prd_bulasik-deterjan","quantity":2},{"productId":"prd_cikolata-80","quantity":1}],
  "address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},
  "expectedTotal":{"amountMinor":19360,"currency":"TRY"}}' | jq
curl -s localhost:8080/v1/orders -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: siparis-0001' \
  -d '{"orderId":"<taslak>","payment":{"method":"CARD","cardToken":"tok_test_4242"}}' | jq
curl -s localhost:8080/v1/orders/<taslak>/3ds -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: onay-0001' -d '{"challengeId":"<tds_...>","otp":"123456"}' | jq   # 3DS istendiyse
curl -s localhost:8080/v1/orders/<taslak> -H "Authorization: Bearer $TOKEN" | jq
```

## Pazaryeri uçları: gateway ne yapar, ne yapmaz

- **Yapar:** bilinmeyen sorgu parametresini reddeder; parametrenin **biçimini** doğrular (`lat` sayı mı,
  `pageSize` tam sayı mı; NaN/sonsuz reddedilir); proto → REST çevirisi (puan ondalık, boş para birimi
  `TRY`, göreli görsel → mutlak URL); servisin doğrulama hatasındaki **proto alan adını istemcinin
  gönderdiği adla** değiştirir (`query` → `q`, `location.lat` → `lat`).
- **Yapmaz:** aralık kuralları (enlem −90..90, arama en az 2 karakter, sayfa boyu kırpma) catalog-service'te
  durur; gateway'de tekrar yazılmaz, iki yerde duran kural bir gün ayrışır.
- **Stok (T8.4, B27):** ürün listesi katalogun sayfasıdır; gateway sayfadaki bütün SKU'ları inventory-svc'ye
  **tek** `CheckAvailability` çağrısıyla sorar ve her ürüne `availableQuantity` yazar (sayfa en fazla 100
  ürün, stok sorgusu da en fazla 100 SKU). Birleştirme `internal/storefront`'ta: katalog adaptörü stoğu,
  stok adaptörü (`internal/inventory`) ürünü bilmez.
  - **0 "tükendi"dir** ve açıkça yazılır.
  - **Stok kaydı olmayan ürün 0'dır** ("satılamaz"; rezervasyon da onu reddeder). Katalog ile stok ayrışmış
    ya da Redis boşalmıştır: günlüğe `WARN` "stok kaydi olmayan urunler 0 gosteriliyor" (market, SKU'lar, `requestId`).
  - **Stok servisi hata verirse ya da `GATEWAY_STOCK_TIMEOUT_MS` (300 ms) aşılırsa** liste yine döner, alan
    **yazılmaz** ("stok bilgisi yok", sözleşme); günlüğe `WARN` "stok okunamadi, urunler stoksuz donuyor".
    Katalog stok yüzünden düşmez; bağlayıcı kontrol rezervasyondadır.
- **Satış durumu (T7.6):** `isActive` her üründe yazılır (`omitempty` yok): liste pasif teklifi de
  döndürür (catalog tasarımı), `false` "satışta değil" demektir; web onu sepete eklemez.
- **Genel arama (T9.6, `GET /v1/search`):** catalog'un `SearchNearby`'si. Dahil etme ve sıra catalog'da
  (açık marketler yakından uzağa, kapalılar sonda; adı eşleşen market ürünsüz de listelenir, pasif teklif
  yok). Gateway sonucu REST'e çevirir: her sonuç yakındaki market satırıdır (`market`, `distanceMeters`)
  + `marketNameMatched`, `products` (en fazla 3) ve `totalProductMatches`; teklif REST'te "ürün"dür.
  - **Stok market başına:** ürünü olan her market için bir `CheckAvailability`, **hepsi paralel**
    (`internal/storefront/search.go`). Neden tek çağrı değil: stok sayaçları market bazında tutulur (Redis
    anahtarında `{market}` hash-tag'i); çok marketi tek okumada okuyan sorgu yok, stok servisi de market
    başına ayrı okurdu. Süre tek çağrınınki kadardır; market sayısı sınırlıdır (en fazla 20).
  - **Bir marketin stoğu gelmezse** yalnızca o marketin ürünleri stoksuz döner, diğerleri etkilenmez
    (aynı `WARN` satırları, `marketId` ile). Kurallar ürün listesiyle ortak (`internal/storefront/stock.go`).
  - `q`'nun kuralı (zorunlu, kırpılmış 2-64) catalog'dadır; gateway yalnızca konumun biçimini doğrular,
    hata `details.q` ile döner.

```bash
curl -s "localhost:8080/v1/markets?lat=40.9885&lng=29.0262" | jq '.data.items[].market.name'   # Ev: 3 market
curl -s "localhost:8080/v1/markets?lat=41.1363&lng=29.8539" | jq '.data.items'                 # Yazlik: []
curl -s "localhost:8080/v1/markets/mkt_migros-jet-moda/products?q=s%C3%BCt" | jq '.data.items[].name'
curl -s "localhost:8080/v1/search?lat=40.9885&lng=29.0262&q=s%C3%BCt" \
  | jq '.data.items[] | {market: .market.name, m: .distanceMeters, urunler: [.products[].name], toplam: .totalProductMatches}'
```

## Ortam değişkenleri

| Değişken                     | Varsayılan        | Anlamı                                          |
| ---------------------------- | ----------------- | ----------------------------------------------- |
| `ASSET_BASE_URL`             | **yok — zorunlu** | Görsel adreslerinin kökü (aşağıda)              |
| `GATEWAY_PORT`               | `8080`            | Dinlenen HTTP portu; en çok 64535 (metrik ucu +1000, #29) |
| `CATALOG_GRPC_ADDR`          | `localhost:50051` | catalog-service adresi (`host:port`)            |
| `INVENTORY_GRPC_ADDR`        | `localhost:50052` | inventory-service adresi (ürün listesi ve genel aramadaki stok, T8.4, T9.6) |
| `ORDER_GRPC_ADDR`            | `localhost:50053` | order-service adresi                            |
| `GATEWAY_REQUEST_TIMEOUT_MS` | `5000`            | Tek bir servis çağrısının üst sınırı            |
| `GATEWAY_STOCK_TIMEOUT_MS`   | `300`             | Stok sorgusunun üst sınırı (genel aramada market başına, paralel); aşılırsa ürünler stoksuz döner (T8.4, T9.6) |
| `GRPC_SHUTDOWN_TIMEOUT_MS`   | `10000`           | Kapanışta devam eden istekler için bekleme      |
| `LOG_LEVEL`                  | `info`            | `trace/debug/info/warn/error/fatal` (Node ile ortak) |
| `MOCK`                       | `false`           | `/healthz`'de bildirilir (B16); `true` ise hesaplar bellekte, Mongo'ya gidilmez |
| `JWT_SECRET`                 | **yok — zorunlu** | Erişim jetonunun imza sırrı, en az 32 bayt (`openssl rand -hex 32`); production'da örnek değer reddedilir |
| `JWT_TTL`                    | `3600`            | Erişim jetonu ömrü (sn)                         |
| `REFRESH_TTL`                | `1209600`         | Yenileme jetonu ömrü (sn, 14 gün; son kullanımdan itibaren) |
| `GATEWAY_MONGO_URI`          | **MOCK değilse zorunlu** | `users` ve `sessions` koleksiyonları (T8.1); gateway'in kendi kullanıcısı, yalnızca kendi veritabanında yetkili (D14) |
| `GATEWAY_MONGO_DB`           | `getir_gateway`   | Veritabanı adı (D14 öncesi ortak `MONGO_URI` / `MONGO_DB` okunmaz) |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `5000`     | Açılışta Mongo'yu bekleme sınırı (Node ile ortak) |
| `REDIS_URL`                  | **MOCK değilse zorunlu** | `redis://` ya da `rediss://`; tekrar koruması kayıtları (T8.2). Ulaşılamazsa gateway açılmaz |
| `REDIS_CONNECT_TIMEOUT_MS`   | `5000`            | Açılışta Redis'i bekleme sınırı (Node ile ortak) |
| `IDEMPOTENCY_TTL_SECONDS`    | `86400`           | Bitmiş tekrar kaydının ömrü (sn); başarılı sipariş ve 3DS kaydı 2 saat |
| `RATE_LIMIT_ENABLED`         | `true`            | `false` hız sınırını kapatır (yük testleri) |
| `RATE_LIMIT_WINDOW_SECONDS`  | `60`              | Kayan pencerenin uzunluğu (sn) |
| `RATE_LIMIT_MAX_REQUESTS`    | `120`             | Genel sınır: katalog, market, `/v1/me`, sipariş okuma (1-10000) |
| `RATE_LIMIT_AUTH_MAX_REQUESTS` | `10`            | Kayıt ve giriş (IP başına); yenileme ve çıkış genel sınırda |
| `RATE_LIMIT_ORDER_MAX_REQUESTS` | `20`           | Rezervasyon, sipariş, 3DS (kullanıcı başına) |
| `NODE_ENV`                   | `development`     | `development/test/production`                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | yok              | İzlerin OTLP/HTTP taban adresi (D15; yerelde `http://localhost:4318`, Jaeger). Boşsa izler oluşur ama gönderilmez |
| `GEO_BASE_URL`               | `https://nominatim.openstreetmap.org` | Harita adres servisinin kökü (T11.8); kendi Nominatim'ini kuran ortam değiştirir |
| `GEO_USER_AGENT`             | `getir-demo-gateway/1.0 (+…)` | Nominatim'e uygulamayı tanıtan ad (kullanım koşulu) |
| `GEO_TIMEOUT_MS`             | `5000`            | Tek adres sorusunun üst sınırı: sırada bekleme + Nominatim cevabı; aşılırsa 503 |

## Görsel adresleri (`ASSET_BASE_URL`)

Veri görseli **göreli yol** olarak saklar (`/img/cat/sut.png`), çünkü mutlak adres ortama
bağlıdır. Sözleşme ise mutlak URL ister (`imageUrl: z.string().url()`). Çeviriyi gateway (BFF)
yapar: CDN değişirse yalnızca bu değişken değişir, veri ve istemci değişmez.

| Veride                  | Cevapta (`ASSET_BASE_URL=https://cdn.x/static`) |
| ----------------------- | ----------------------------------------------- |
| `/img/cat/sut.png`      | `https://cdn.x/static/img/cat/sut.png`          |
| `""`                    | alan hiç yazılmaz                               |
| `https://baska.cdn/a.png` | olduğu gibi                                   |
| `javascript:…`, `data:…` | alan hiç yazılmaz (`<img src>`'ye zararlı adres gitmez) |
| `/img/../../x.png`      | `https://cdn.x/static/x.png` (kökün üstüne çıkamaz) |

**Zorunludur, varsayılanı yoktur (fail fast).** Görsellerin nerede barınacağı henüz
kararlaştırılmadı; bir varsayılan bu kararı koda gömer ve canlıda unutulursa istemciye sessizce
`localhost` adresleri gider. Verilmezse gateway açılışta durur:

```text
ortam degiskenleri gecersiz: ASSET_BASE_URL: zorunlu, ornek: http://localhost:5173
```

## `/healthz` sözleşmesi

```json
{ "success": true, "data": { "status": "ok", "mock": false,
  "services": [ { "name": "catalog",   "status": "SERVING", "latencyMs": 5 },
                { "name": "inventory", "status": "SERVING", "latencyMs": 2 },
                { "name": "mongo",     "status": "SERVING", "latencyMs": 1 },
                { "name": "order",     "status": "SERVING", "latencyMs": 6 },
                { "name": "redis",     "status": "SERVING", "latencyMs": 1 } ] } }
```

`mongo` (T8.1) ve `redis` (T8.2) kalemleri yalnızca `MOCK=false` iken vardır; MOCK'ta hesaplar
ve tekrar kayıtları bellekte tutulur. `inventory` T8.4'ten beri listede ve diğer servislerle aynı
kurala tabidir: kapalıysa `/healthz` 503 döner. Ürün listesi ve genel arama o sırada da stoksuz çalışır.

Bir servis düşükse **503** ve hata zarfı döner; rapor `error.details` içindedir. Servis
durumu üç değerlidir: `SERVING`, `NOT_SERVING` (servis kendini hasta bildirdi) ve
`UNREACHABLE` (cevap gelmedi). Ulaşılamayan serviste `error` alanı yalnızca gRPC durum kodunu
taşır (`Unavailable`); iç ağ adresi `/healthz` dışarıya açık olduğu için cevaba konmaz. Sorgusu
panikleyen bağımlılık `UNREACHABLE` + `Internal` olur; panik yalnızca günlüktedir (T8.3).

## Hata modeli (`internal/apperror`)

Her cevabın HTTP kodu ve **mesajı koddan** türetilir; handler ikisini de seçemez. Tablo elle
yazılmaz, `@getir/core/error-codes.ts` (kod → HTTP) ve `@getir/contracts/errors.ts` (kod →
kullanıcı mesajı) kaynaklarından **üretilir**:

```bash
pnpm build && pnpm codes:go          # apps/gateway/internal/apperror/codes_gen.go
pnpm codes:go:check                  # fark varsa exit 1 (pnpm verify ve CI bunu kosar)
```

Üretilen dosya depoya girer ki Go tarafı Node olmadan derlenebilsin.

Bağımlı servis hatası şu sırayla çözülür:

1. `x-app-error` trailer'ı (service-kit'in yazdığı AppError JSON'u) varsa ve kod sözlükteyse → o
   kod ve `details`. Ayrıntı bir JSON **nesnesi** olmalı (dizi ya da sayı düşürülür); değerleri
   OLDUĞU GİBİ geçer (T7.5): `PRICE_CHANGED`'in güncel toplamı sayı, satışta olmayan ürünler dizi
   olarak istemciye ulaşır. (Önceki sürüm yalnızca metin → metin kabul ediyordu ve bu sayılar
   yolda kayboluyordu.)
2. Yoksa gRPC durum kodu → hata kodu (`service-kit` `errorCodeForStatus` ile aynı eşleme):
   `Unavailable` / `DeadlineExceeded` / `Canceled` → `SERVICE_UNAVAILABLE` 503, `NotFound` →
   `NOT_FOUND`, `InvalidArgument` → `VALIDATION_FAILED`, bilinmeyen → `INTERNAL`.

Servisin kendi mesajı ve asıl hata istemciye gitmez, `istek hatayla dondu` günlük satırına
yazılır (4xx `WARN`, 5xx `ERROR`). Her gRPC çağrısı `x-request-id` metadata'sı taşır; servis
günlüğü gateway günlüğüyle aynı kimlikle eşleşir.

### Fiber hataları

Fiber'in kendi ürettiği hatalar (bilinmeyen yol, yanlış fiil, çok büyük başlık) hata
sözlüğündeki bir koda indirilir. Cevaptaki HTTP kodu **her zaman** o kodun
`@getir/core/error-codes.ts` tablosundaki karşılığıdır:

| Fiber'in ham kodu | Cevap                        |
| ----------------- | ---------------------------- |
| 404, 405          | `NOT_FOUND` 404              |
| Diğer 4xx         | `VALIDATION_FAILED` 400      |
| 5xx               | `INTERNAL` 500               |

Ham kod kaybolmaz: günlükteki `istek hatayla dondu` satırının `rawStatus` alanına yazılır (T8.3).

### Panik (T8.3)

Fiber paniği kendiliğinden yakalamaz: bir uçtaki beklenmedik panik (boş işaretçi, sınır dışı dizin)
bütün gateway sürecini düşürürdü. `internal/httpapi/recover.go` paniği hataya çevirir:

- İstemci **500 `INTERNAL`** zarfı alır; mesaj diğer iç hatalarla aynıdır. Panik değeri ve yığın izi
  cevaba **girmez**.
- Günlüğe tek `ERROR` satırı yazılır: `istek panikle dondu`, `requestId`, `err` (panik değeri) ve
  `stack`. İstek satırı (`http istegi`) aynı kimlikle 500 yazar; kurtarma katmanı istek günlüğünün
  içinde çalışır.
- Panik değeri cevabı **seçmez**: `panic(NOT_FOUND hatası)` da 500'dür (Fiber'in varsayılanı onu
  404 yapardı).
- `/healthz` bağımlılıkları ayrı goroutine'lerde sorar; oradaki panik ara katmana ulaşmaz.
  `health.Checker` kendisi yakalar: bağımlılık `UNREACHABLE` + `Internal` raporlanır, panik
  `saglik sorgusunda panik` satırına istek kimliğiyle yazılır.

**Kabul testi** (`internal/httpapi/envelope_test.go`): kayıtlı **bütün rotalar** kimliksiz, gövdesiz
istekle taranır. Her cevap katı zarfta, kod sözlükte, HTTP kodu koddan, `requestId` başlık = gövde =
günlük; hata cevabının `istek hatayla dondu` satırı vardır. Yeni rota kendiliğinden taranır; yeni
bir yol parametresi `routeParamValues`'a değer ister.

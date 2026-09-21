# @getir/proto

Servisler arası **gRPC sözleşmelerinin tek doğruluk kaynağı**. Bu klasördeki `.proto`
dosyaları `buf` ile doğrulanır; buradan hem TypeScript (Node servisleri) hem Go
(`apps/gateway`) kodu üretilir.

Sınır net: REST/JSON yüzeyi buraya girmez, o `docs/api/openapi.yaml` dosyasındadır.
Buradaki dosyalar yalnızca **servisten servise** konuşmayı tanımlar.

## Klasör düzeni

```text
packages/proto/
├── buf.yaml              # modül, lint (STANDARD) ve breaking (WIRE_JSON) ayarları
├── buf.gen.ts.yaml       # TypeScript üretimi (ts-proto)   — eklenti node_modules'ten
├── buf.gen.go.yaml       # Go üretimi (protoc-gen-go[-grpc]) — eklenti `go install`'dan
├── package.json          # @getir/proto — npm paketi olarak dışarı verilen yüzey
├── tsconfig.json         # üretilen TS'in tip denetimi (gen/ts + test)
├── tsconfig.build.json   # gen/ts -> dist derlemesi
├── go.mod / go.sum       # üretilen Go kodunun modülü
├── tools.go              # `go mod tidy`'nin require satırlarını silmesini engeller
├── scripts/
│   └── write-barrel.mjs  # gen/ts/index.ts üreteci (paketin tek giriş noktası)
├── proto/                # <-- import kökü
│   └── getir/
│       ├── common/v1/common.proto    # package getir.common.v1
│       └── catalog/v1/catalog.proto  # package getir.catalog.v1
├── test/unit/            # üretilen kodun çalışma zamanı testleri
├── gen/                  # ÜRETİLEN kod — commit EDİLMEZ (aşağıya bakın)
│   ├── ts/               #   index.ts + getir/**/*.ts
│   └── go/               #   getir/**/*.pb.go
└── dist/                 # gen/ts'in derlenmiş hâli — commit EDİLMEZ
```

> **Bu pakette elle yazılmış TypeScript yoktur.** `src/` klasörü bilerek yoktur: paketin
> TypeScript yüzeyinin tamamı `.proto` dosyalarından üretilir. Elle yazılan tek TS, üretilen
> kodu sınayan `test/unit/generated.spec.ts` dosyasıdır.

### Paket adı = dizin yolu

Bu bir stil tercihi değil, `buf` aracının `PACKAGE_DIRECTORY_MATCH` kuralıdır; ihlali
lint'i kırar. Kural şudur: `package` satırındaki noktalar, `proto/` altındaki klasör
ayraçlarına birebir karşılık gelir.

| Paket adı          | Bulunması zorunlu yol                  | Import satırı                              |
| ------------------ | -------------------------------------- | ------------------------------------------ |
| `getir.common.v1`  | `proto/getir/common/v1/common.proto`   | `import "getir/common/v1/common.proto";`   |
| `getir.catalog.v1` | `proto/getir/catalog/v1/catalog.proto` | `import "getir/catalog/v1/catalog.proto";` |

Dikkat: import yolu `proto/` ile **başlamaz**. `buf.yaml` içindeki `modules[].path: proto`
ayarı `proto/` klasörünü import kökü yapar; bu yüzden `.proto` dosyalarındaki import
satırları deponun klasör düzeninden bağımsızdır.

Ek adlandırma kuralları:

- Dosya adı `lower_snake_case` (`FILE_LOWER_SNAKE_CASE`).
- Paket adı `<org>.<alan>.v1` biçimindedir ve sürüm ekiyle biter (`PACKAGE_VERSION_SUFFIX`).
- Her servis adı `Service` ile biter: `CatalogService` (`SERVICE_SUFFIX`).
- Her dosyada `syntax = "proto3";` ve `option go_package = ...` bulunur.

## Kapsam: neyin hangi dosyada olduğu

| Dosya                          | Taşıdığı                                        | Görev |
| ------------------------------ | ----------------------------------------------- | ----- |
| `common/v1/common.proto`       | `Money`, sayfalama, ortak hata ve zaman tipleri | T1.6  |
| `catalog/v1/catalog.proto`     | Ürün, kategori, dark store                      | T1.6  |
| `inventory/v1/inventory.proto` | Stok ve rezervasyon RPC'leri                    | T2.1  |
| `order/v1/order.proto`         | Sipariş yaşam döngüsü                           | T2.1  |
| `payment/v1/payment.proto`     | Ödeme yetkilendirme ve iade                     | T2.1  |
| `risk/v1/risk.proto`           | Risk/fraud değerlendirmesi                      | T2.1  |
| `courier/v1/courier.proto`     | Kurye atama ve rota                             | T2.1  |

**B27 kararı — `catalog.proto` stok döndürmez.** Stok sorgusu **toplu** yapılır ve stok
RPC'leri `inventory.proto` dosyasına aittir. Katalog yalnızca ürün, kategori ve depo
verisi taşır. Gerekçe: ürün listesi önbelleğe alınabilir ve uzun ömürlüdür, stok ise
saniyelik değişir; ikisi aynı yanıtta dönerse katalog önbelleği stok yüzünden sürekli
geçersizleşir.

## Sözleşme kuralları

**Para her yerde kuruştur.** `float` ve `double` yasaktır. Para taşıyan her alan
`getir.common.v1.Money` kullanır: `amount_minor` (`int64`, minor unit) + `currency`
(`string`, ISO-4217, varsayılan `"TRY"`). Gerekçe: kayan nokta 19.99 TL'yi tam tutamaz
ve toplamlarda kuruş kayar.

### Alan numarası kuralları

Alan numarası, tel formatındaki **tek kimliktir** — alan adı değil. Bundan çıkan kurallar:

1. **Numara asla yeniden kullanılmaz.** Silinen bir alanın numarası yeni bir alana
   verilirse, eski sürümdeki bir istemci o baytları eski tipte okumaya devam eder ve veri
   sessizce bozulur: hata fırlamaz, yanlış değer okunur.

2. **Silinen alan `reserved` ile işaretlenir** — hem numarası hem adı:

   ```proto
   message Product {
     reserved 4, 7 to 9;
     reserved "legacy_price", "old_sku";

     string id = 1;
     string name = 2;
   }
   ```

   İkisi birden gerekir, çünkü `WIRE_JSON` breaking setinde iki ayrı kural vardır:
   `FIELD_NO_DELETE_UNLESS_NUMBER_RESERVED` (tel formatı için numara) ve
   `FIELD_NO_DELETE_UNLESS_NAME_RESERVED` (JSON adı için ad). Yalnızca birini yazmak
   `buf breaking` kapısını kırar.

3. **Alan tipi değiştirilmez.** Tip değişikliği gerekiyorsa eski alan `reserved` edilir ve
   yeni numarayla yeni bir alan eklenir.

4. **Enum'un 0 değeri `..._UNSPECIFIED` olur.** proto3'te 0 tel üzerinde hiç gönderilmez;
   "set edilmedi" ile "gerçekten ilk değer" ayrımı ancak ayrılmış bir sıfır değeriyle
   yapılabilir.

   ```proto
   enum ProductUnit {
     PRODUCT_UNIT_UNSPECIFIED = 0;
     PRODUCT_UNIT_PIECE = 1;
     PRODUCT_UNIT_KILOGRAM = 2;
   }
   ```

   Değer adları, enum adının `UPPER_SNAKE` hâliyle başlamak zorundadır
   (`ENUM_VALUE_PREFIX`).

5. **Her RPC'nin kendi istek/yanıt mesajı vardır.** `ListProducts` →
   `ListProductsRequest` / `ListProductsResponse`. Paylaşılan mesaj kullanılmaz: iki RPC
   aynı mesajı paylaşırsa, birine alan eklemek diğerinin sözleşmesini de değiştirir.

## Yeni alan / yeni servis ekleme

Sıra önemlidir. `.proto` her zaman ilk adımdır; üretilen kod hiçbir zaman elle düzenlenmez.

**Mevcut bir mesaja alan eklemek**

1. `.proto` dosyasında, o mesajdaki **en büyük numaranın bir fazlasını** kullanarak alanı
   ekle. `reserved` listesindeki numaralara dokunma.
2. `pnpm --filter @getir/proto lint` — biçim ve adlandırma kapısı.
3. `pnpm --filter @getir/proto breaking` — `main` ile uyum kapısı. Yeni alan eklemek
   kırıcı değildir; bu adım asıl olarak yanlışlıkla yapılan silme ve yeniden
   numaralandırmayı yakalar.
4. `pnpm proto:gen` — TS ve Go kodunu üretir. Go kurulu değilse `pnpm proto:gen:ts` yeter.
5. Alanı kullanan servisi güncelle.

**Yeni servis (yeni `.proto` dosyası) eklemek**

1. Paket adını seç: `getir.<alan>.v1`. Dosyayı **tam karşılığı olan** dizine koy:
   `proto/getir/<alan>/v1/<alan>.proto`.
2. Dosyanın başına şu üç satırı yaz:

   ```proto
   syntax = "proto3";

   package getir.<alan>.v1;

   option go_package = "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/<alan>/v1;<alan>v1";
   ```

3. Servisi `...Service` ekiyle adlandır; her RPC için ayrı `...Request` / `...Response`
   mesajları tanımla.
4. Yukarıdaki lint → breaking → generate sırasını koş.

## Kod üretimi

### Üretim iki şablona ayrılmıştır

| Şablon            | Eklenti                     | Eklenti nereden gelir | Kim koşar                                 |
| ----------------- | --------------------------- | --------------------- | ----------------------------------------- |
| `buf.gen.ts.yaml` | `protoc-gen-ts_proto`       | `pnpm install`        | Herkes — `pnpm verify` bunu zorunlu koşar |
| `buf.gen.go.yaml` | `protoc-gen-go`, `-go-grpc` | `go install`          | Go kuranlar + CI'daki `codegen` işi       |

Ayrılmalarının sebebi tek bir cümle: **Go eklentileri herkeste yoktur.** Tek dosyada
dursalardı, Go kurmamış bir geliştiricide (ve CI'daki `quality` işinde) `buf generate` eksik
eklenti yüzünden patlar, üstelik TypeScript tarafının Go ile hiçbir işi olmamasına rağmen.
Bu ayrım sayesinde `pnpm typecheck` yalnızca TS şablonunu koşar ve Go'dan bağımsız yeşil kalır.

### Eklenti kurulumu (Go)

Sürümler **`go.mod` dosyasından** gelir; `@latest` yazılmaz. Böylece herkes ve CI aynı eklenti
sürümüyle üretir, üretilen kod makineden makineye değişmez. `tools.go` dosyası bu sürüm
satırlarının `go mod tidy` tarafından silinmesini engeller.

**Windows (PowerShell):**

```powershell
cd packages\proto
go install google.golang.org/protobuf/cmd/protoc-gen-go
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc
```

İkililer `C:\Users\<kullanici>\go\bin\` altına iner.

**macOS / Linux:**

```bash
cd packages/proto
go install google.golang.org/protobuf/cmd/protoc-gen-go
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc
```

İkililer `$(go env GOPATH)/bin` altına iner.

> **PATH notu — en sık takılınan yer.** `buf`, `local:` eklentilerini **PATH üzerinden**
> bulur. `%USERPROFILE%\go\bin` (Windows) veya `$(go env GOPATH)/bin` (Unix) PATH'te
> değilse `buf generate` şu hatayı verir:
>
> ```text
> plugin protoc-gen-go: exec: "protoc-gen-go": executable file not found in $PATH
> ```
>
> Kurulumu doğrulamak için:
>
> ```powershell
> protoc-gen-go --version       # PowerShell
> ```
>
> ```bash
> protoc-gen-go --version       # bash/zsh
> ```
>
> `protoc-gen-ts_proto` için aynı sorun **yoktur**: pnpm, script'leri koşarken
> `node_modules/.bin` klasörünü PATH'e kendisi ekler. Bu yüzden TS üretimi `pnpm run`
> üzerinden çağrılmak zorundadır; `buf generate --template buf.gen.ts.yaml` komutunu
> çıplak kabukta koşarsanız eklenti bulunamaz.

### Komutlar

Depo kökünden:

| Komut               | Yaptığı iş                                               | Go gerekir mi |
| ------------------- | -------------------------------------------------------- | ------------- |
| `pnpm proto:gen`    | TS **ve** Go kodunu üretir                               | Evet          |
| `pnpm proto:gen:ts` | Yalnızca TS kodunu üretir                                | Hayır         |
| `pnpm proto:check`  | Üretir ve **iki dilde de derler** — T2.3'ün bitti ölçütü | Evet          |
| `pnpm lint:proto`   | `buf lint` + `buf format --diff --exit-code`             | Hayır         |

Paket klasöründen (`pnpm --filter @getir/proto <script>` ile de çağrılabilir):

| Script        | Karşılığı                                          |
| ------------- | -------------------------------------------------- |
| `generate:ts` | `buf generate --template buf.gen.ts.yaml` + barrel |
| `generate:go` | `buf generate --template buf.gen.go.yaml`          |
| `generate`    | ikisi sırayla                                      |
| `typecheck`   | `tsc -p tsconfig.json` (üretilen kodu denetler)    |
| `build`       | `tsc -p tsconfig.build.json` (gen/ts → dist)       |
| `check:go`    | `generate:go` + `go build ./...`                   |
| `lint`        | `buf lint`                                         |
| `breaking`    | `main` dalına karşı geriye uyum kapısı             |
| `clean`       | `gen/` ve `dist/` klasörlerini siler               |

> **`build` ve `typecheck` tek başına çalıştırılmaz.** İkisi de `gen/ts`'in var olmasını
> bekler ve temiz bir klonda o klasör yoktur. Sıra `turbo.json` içinde kurulmuştur: her iki
> görev de `generate:ts` görevine bağlıdır, bu yüzden `pnpm build` / `pnpm typecheck`
> **depo kökünden** koşulduğunda üretim kendiliğinden önce çalışır.

### Neden `eslint`'ten önce üretim koşar

`pnpm verify` zinciri `pnpm proto:gen:ts` ile **başlar**. Sebebi şudur: `eslint` turbo
üzerinden değil doğrudan (`eslint .`) koşar, yani `turbo.json` içindeki `generate:ts`
bağımlılığı onu kapsamaz. `test/unit/generated.spec.ts` üretilen koddan import ettiği için,
dosyalar yoksa tip bilgili ESLint kuralları tipi çözemez ve onlarca
`Unsafe member access` hatası verir — gerçek bir sorun olmadığı hâlde. Aynı sıra CI'daki
`quality` işinde de vardır.

## Üretilen kodu kullanmak

Paket tek bir giriş noktası verir ve her proto paketi ayrı bir **ad alanıdır**:

```ts
import { catalogV1, commonV1 } from '@getir/proto';

const money: commonV1.Money = { amountMinor: 4599, currency: 'TRY' };

const client = new catalogV1.CatalogServiceClient(
  'catalog:50051',
  ChannelCredentials.createInsecure(),
);
```

Ad alanı listesi `gen/ts/index.ts` içinde `scripts/write-barrel.mjs` tarafından üretilir:
`getir.catalog.v1` → `catalogV1`, `getir.common.v1` → `commonV1`, `google.protobuf` →
`googleProtobuf`.

**Neden düz `export *` değil?** Üretilen her dosya `protobufPackage` adlı bir sabit dışarı
verir. Düz `export *` ile yedi dosyanın yedisi aynı adı verir ve paket hiç derlenmez. Ayrıca
`Money` ve `GeoPoint` gibi ortak tipler birden çok dosyadan yeniden dışarı verilebilir.
Ad alanı bu sınıfın tamamını kökten çözer ve çağrı yerinde tipin hangi sözleşmeden geldiğini
okunur kılar.

### Zod şemaları ile ilişkisi

`@getir/proto` tipleri **servisten servise** (gRPC) konuşmayı tanımlar; `@getir/contracts`
içindeki Zod şemaları ise **tarayıcı → gateway** (REST/socket) yüzeyini. İkisi birbirinin
yerine geçmez ve biri diğerinden türetilmez. Alan adları kasıtlı olarak örtüşür
(`snakeToCamel=true` sayesinde `amount_minor` → `amountMinor`), böylece gateway'de çeviri
tek tek alan eşlemesi değil, doğrudan atama olur.

## Üretilen kod commit edilmez

`gen/` klasörü **kaynak değil, çıktıdır** ve depoya girmez:

- Kök `.gitignore` zaten `packages/proto/gen/` satırını içerir (`dist/` da genel olarak yok sayılır).
- `.prettierignore` `packages/proto/gen` satırını içerir; üretilen kod biçim kapısına takılmaz.
- `.gitattributes` bu yolu `linguist-generated=true -diff` ile işaretler.

Gerekçe: üretilen kod hem büyüktür hem de her `buf generate` çağrısında bütünüyle
değişir. Commit edilirse her PR'ın diff'i okunamaz hâle gelir ve iki geliştirici farklı
eklenti sürümüyle üretince gereksiz çakışma çıkar. Kodu çeken herkes `pnpm proto:gen` ile
kendi kopyasını üretir.

**Bunun bedeli var ve bilerek ödeniyor:** üretilen kod depoda olmadığı için, bir `.proto`
değişikliğinin çıktıyı derlenemez hâle getirip getirmediği `buf lint` ile anlaşılamaz.
Bu yüzden CI'da ayrı bir **`codegen`** işi vardır: her PR'da kodu gerçekten üretir ve
**hem TypeScript hem Go** tarafını derler. `buf lint` yeşilken Go çıktısının derlenmemesi
mümkündür; o işin var olma sebebi tam olarak budur.

**`go mod tidy` tuzağı.** `gen/go` depoda olmadığı için temiz bir klonda bu modülde tek bir
`.go` dosyası bulunmaz. O durumda `go mod tidy` hiçbir paketin kullanılmadığını görür ve tüm
`require` satırlarını siler; bir sonraki üretimden sonra derleme bağımlılık bulunamadığı için
patlar. `tools.go` dosyası (`//go:build tools`) bunu engeller: hiçbir normal derlemeye
girmez, ama `go mod tidy` build etiketlerini hesaba kattığı için sürümleri canlı tutar.

## Bugünün durumu (T2.3)

| Komut               | Durum                                                          |
| ------------------- | -------------------------------------------------------------- |
| `buf lint`          | **Çalışıyor**                                                  |
| `buf format`        | **Çalışıyor** — `pnpm lint:proto` içinde                       |
| `buf breaking`      | **Çalışıyor** — `main` tabanı ilk merge'den sonra anlamlı      |
| `pnpm proto:gen:ts` | **Çalışıyor** — ts-proto çıktısı + `gen/ts/index.ts`           |
| `pnpm proto:gen`    | **Çalışıyor** — TS + Go çıktısı (Go eklentileri kurulu olmalı) |
| `pnpm proto:check`  | **Çalışıyor** — üretilen kod TS ve Go'da derleniyor            |

T2.3 ile kapanan kapılar:

- Üretilen TypeScript, projenin **tam strict** ayarlarıyla (gevşetilmiş tek bir derleyici
  seçeneği olmadan) sıfır hatayla derleniyor. Bunu mümkün kılan iki ts-proto seçeneği
  `buf.gen.ts.yaml` içinde gerekçeleriyle yazılıdır: `importSuffix=.js` (ESM'de göreli
  import uzantılı olmak zorunda) ve `useExactTypes=false` (aksi hâlde `fromPartial`
  imzasında örtük `any` çıkıp TS7006 veriyor).
- Üretilen Go, `packages/proto` modülü altında `go build ./...` ile derleniyor.
- `test/unit/generated.spec.ts` üretilen kodu gerçekten **yükleyip çalıştırıyor**. Bu, tip
  denetiminin yakalayamadığı bir sınıf hatayı kapatır: ESM altında CommonJS bir paketi
  (`@grpc/grpc-js`) yanlış biçimde import etmek derlemede değil, ilk `new` çağrısında
  patlar.

Sırada T2.4 var: `packages/service-kit` — gRPC bootstrap, health RPC, Zod doğrulama ara
katmanı ve graceful shutdown. Bu paketin ilk tüketicisi `@getir/proto` olacak.

# @getir/proto

Servisler arası **gRPC sözleşmelerinin tek doğruluk kaynağı**. Bu klasördeki `.proto`
dosyaları `buf` ile doğrulanır; buradan hem TypeScript (Node servisleri) hem Go
(`apps/gateway`) kodu üretilir.

Sınır net: REST/JSON yüzeyi buraya girmez, o `docs/api/openapi.yaml` dosyasındadır.
Buradaki dosyalar yalnızca **servisten servise** konuşmayı tanımlar.

## Klasör düzeni

```text
packages/proto/
├── buf.yaml            # modül, lint (STANDARD) ve breaking (WIRE_JSON) ayarları
├── buf.gen.yaml        # kod üretimi eklentileri — T2.3'e kadar sadece yapılandırma
├── package.json        # @getir/proto — buf komutlarının kısayolları
├── README.md
├── proto/              # <-- import kökü
│   └── getir/
│       ├── common/v1/common.proto    # package getir.common.v1
│       └── catalog/v1/catalog.proto  # package getir.catalog.v1
└── gen/                # ÜRETİLEN kod — commit EDİLMEZ (aşağıya bakın)
    ├── ts/
    └── go/
```

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
4. `pnpm --filter @getir/proto generate` — TS ve Go kodunu üretir (T2.3'ten itibaren).
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

## Komutları koşmak (Windows)

`buf` bu projede bir npm bağımlılığı **değildir**; Go ile kurulur:

```powershell
go install github.com/bufbuild/buf/cmd/buf@latest
```

İkili şuraya iner: `C:\Users\<kullanici>\go\bin\buf.exe`.

> **PATH notu:** `%USERPROFILE%\go\bin` PATH'te olmayabilir — bu makinede değil. O hâlde
> `buf lint` komutu "command not found" verir ve aşağıdaki `pnpm run` script'leri çalışmaz.
> PATH'e eklemeden koşmak için tam yolu kullanın:
>
> ```powershell
> & "$env:USERPROFILE\go\bin\buf.exe" --version
> ```

**Depo kökünden**, yol argümanıyla (en pratiği):

```powershell
& "$env:USERPROFILE\go\bin\buf.exe" lint packages/proto
& "$env:USERPROFILE\go\bin\buf.exe" breaking packages/proto --against ".git#branch=main,subdir=packages/proto"
```

**Paket klasöründen**, `package.json` script'leriyle:

```powershell
cd packages\proto
pnpm run lint        # buf lint
pnpm run breaking    # buf breaking --against "../../.git#branch=main,subdir=packages/proto"
pnpm run generate    # buf generate  (T2.3'e kadar eklentiler kurulu değil; hata verir)
pnpm run clean       # gen/ klasörünü siler
```

Depo kökünden filtreyle de çağrılabilir: `pnpm --filter @getir/proto lint`.

> **`--against` yolundaki `../../` neden var?** `buf`, `.git` yolunu **komutun çalıştığı
> dizine göre** çözer. Script'ler `packages/proto` içinde koştuğu için `.git` iki üst
> klasördedir. `--against ".git#..."` yazmak `packages/proto/.git` arar ve
> "does not appear to be a git repository" hatası verir. `subdir=packages/proto` kısmı ise
> depo köküne göredir ve değişmez — bu yüzden depo kökünden koşarken `.git` doğru olandır.

CI aynı iki kapıyı `.github/workflows/ci.yml` içindeki `contract` işinde koşar; orada
karşılaştırma tabanı yerel `.git` değil, uzak depodur.

## Üretilen kod commit edilmez

`gen/` klasörü **kaynak değil, çıktıdır** ve depoya girmez:

- Kök `.gitignore` zaten `packages/proto/gen/` satırını içerir.
- `.prettierignore` `packages/proto/gen` satırını içerir; üretilen kod biçim kapısına takılmaz.
- `.gitattributes` bu yolu `linguist-generated=true -diff` ile işaretler.

Gerekçe: üretilen kod hem büyüktür hem de her `buf generate` çağrısında bütünüyle
değişir. Commit edilirse her PR'ın diff'i okunamaz hâle gelir ve iki geliştirici farklı
eklenti sürümüyle üretince gereksiz çakışma çıkar. Kodu çeken herkes
`pnpm --filter @getir/proto generate` ile kendi kopyasını üretir.

## Bugünün durumu (T1.6)

| Komut          | Durum                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| `buf lint`     | **Çalışıyor** — bugün yeşil olması gereken tek kapı                    |
| `buf breaking` | `main` dalında `packages/proto` henüz yok; ilk merge'den sonra anlamlı |
| `buf generate` | **Placeholder** — eklentiler kurulu değil; kod üretimi T2.3'ün işi     |

Kök `package.json` içindeki `pnpm proto:gen` de hâlâ bir placeholder'dır ve T2.3'te bu
paketteki `generate` script'ine bağlanacaktır.

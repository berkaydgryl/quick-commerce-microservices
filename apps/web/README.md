# apps/web

Müşteri arayüzü: React 18 + Vite + TypeScript. Tarayıcı yalnızca gateway ile konuşur (`/v1/*`).

## Bugünkü durum (T9.5 — teslimat adresi; T9.6 — genel arama; T8.5 — kimlik akışı; T7.6 — kalıcı sepet, stok sınırı, satışta olmayan teklif; T6.4 — sepet kabuğu)

| Parça                   | Durum                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Vite + React + router   | ✅ `/` ilk ekran: teslimat adresi, genel arama (`?ara=`), yakındaki marketler · `/markets` · `/markets/:id` market sayfası |
| TanStack Query          | ✅ Yalnızca geçici hata (`SERVICE_UNAVAILABLE`) yeniden denenir; mutasyon denenmez                                         |
| HTTP istemcisi          | ✅ Zarf açıcı → `AppError`; mutasyon `Idempotency-Key`'siz derlenmez (ADR-08)                                              |
| Idempotency key         | ✅ `crypto.randomUUID()`, sözleşmedeki uzunluk sınırıyla                                                                   |
| Design token'lar        | ✅ `tokens.css`: marka paleti, Nunito, `clamp()` ölçeği, kapsayıcı, bileşen ölçüleri (D11)                                 |
| Kırılımlar              | ✅ `@custom-media` (48rem / 64rem), JS karşılığı `shared/config/breakpoints.ts`                                            |
| Market veri hook'ları   | ✅ `useNearbyMarkets`, `useMarket`, `useMarketCategories`, `useMarketProducts` (imleçle sayfalı), `useNearbySearch` (T9.6) |
| Ortak durumlar          | ✅ `QueryStatus`: yükleniyor / hata / boş; \"Tekrar dene\" yalnızca geçici hatada                                          |
| Zustand (sepet, oturum) | ✅ Sepet (`useCartStore`, `getir.cart`); seçili adres (`useAddressStore`, `getir.address`); oturum (bellekte)              |
| Kimlik (T8.5)           | ✅ `/giris`, `/kayit`, `/hesabim` (korumalı); sessiz yenileme, sekmeler arası kilit (aşağıda)                              |
| Teslimat adresi (T9.5)  | ✅ Ana sayfada aramanın üstünde; hesabın adresleri; marketler ve arama seçili adresin konumuyla (aşağıda)                  |

## Kimlik akışı (T8.5)

Ekranlar `GetirMarket-Giriş-Ekranı` referansına göre: fotoğrafsız marka kartı, `+90` önekli telefon,
göster/gizle düğmeli şifre; "Şifremi unuttum" ve sosyal girişler yok. Kayıt aynı düzende (ad soyad,
telefon, şifre). Başlıkta oturumsuzken "Giriş yap", oturumdayken "Hesabım" (dar ekranda yalnızca ikon).

| Katman        | Dosya                                                    | İş                                                                                   |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Oturum deposu | `shared/session/session-store.ts`                        | `unknown` / `anonymous` / `authenticated`; erişim jetonu **yalnızca bellekte**       |
| Kilit         | `shared/session/session-lock.ts`                         | Yenileme, giriş, kayıt, çıkış bütün sekmelerde sırayla (Web Locks, `getir-oturum`)   |
| Yenileyici    | `shared/session/session-refresher.ts`                    | Sekme içinde tek uçuş; 401 → oturumsuz; geçici hata fırlatılır, oturum yerinde kalır |
| Yetkili istek | `shared/session/authorized-client.ts`                    | `Bearer` ekler; 401'de **bir kez** yeniler ve **bir kez** tekrarlar (döngü yok)      |
| Açılış        | `shared/session/restore-session.ts` (`main.tsx`)         | Sayfa yenilenince bir kez sessiz yenileme; herkese açık sayfa beklemez               |
| Formlar       | `features/auth/services/form-schemas.ts`, `ui/*Form.tsx` | react-hook-form + zodResolver; kurallar ve alan mesajları `@getir/contracts`'tan     |
| Sunucu hatası | `features/auth/services/server-errors.ts`                | Alan altına / form üstüne; metin sözlükten; 429'da kalan saniye                      |
| Dönüş adresi  | `features/auth/services/next-path.ts`                    | `?next=` yalnızca uygulama içi yol (`//site`, `/\site`, mutlak adres → ana sayfa)    |
| Koruma        | `features/auth/ui/RequireAuth.tsx`                       | Oturum yoksa `/giris?next=...`; girişle geri döner                                   |

- **Neden kilit:** yenileme jetonu her kullanımda değişir; kullanılmış jetonu gönderen istek 401 alır
  ve gateway çerezi siler. İki sekme aynı anda yenilese ikisi birden oturumu kaybederdi. Kilitle ikinci
  sekme birincinin yazdığı yeni çerezi gönderir (`session-refresher.spec.ts` iki sekmeyi canlandırır).
  Web Locks yoksa (ör. `http://192.168...` gibi güvensiz bağlam) kilit yalnızca sekme içindedir.
- **Açılışta geçici hata** (ağ, 503): sekme oturumsuz açılır; çerez yerinde kaldığı için sonraki açılış
  oturumu geri getirir. Oturumsuz ziyaretçide açılış yenilemesi 401 alır; tarayıcı konsolunda bu bir
  kırmızı ağ satırı olarak görünür (çerez HttpOnly: betik varlığını soramaz).
- **Çıkış** başarılıysa sayfa ana sayfaya yeniden yüklenir: bellekteki jeton ve profil önbelleği tek adımda
  gider. Uygulama içi geçiş kullanılmaz: oturum silinince korumalı sayfanın giriş yönlendirmesi ana sayfaya
  giden geçişle yarışıyordu (canlı testte bulundu). Çıkış başarısızsa oturum yerinde kalır ve hata
  gösterilir: betik HttpOnly çerezi silemez; "çıkıldı" görünüp yenilemede geri gelen oturum yanıltırdı.
- **Kayıt anahtarı:** `Idempotency-Key` her gönderimde yenidir (ADR-08 eki: kayıt cevabı saklanmaz);
  numarayı düzeltip yeniden gönderen kullanıcı parmak izi çakışması (409) görmez.
- **Aynı kaynak:** yenileme çerezi `SameSite=Strict`, `Path=/v1/auth`; web ile gateway aynı kaynaktan
  (geliştirmede Vite vekili) konuşmalıdır. `VITE_API_BASE_URL` başka bir kaynağı gösterirse oturum kurulmaz.

### Demo persona seçici (yalnızca geliştirme)

Giriş ekranının altında Ayşe, Zeynep, Can, Ali ve Komşu: seçilen persona telefon ve demo şifresini
**doldurur**, girişi kullanıcı yapar. Bayrak derleme zamanıdır (`vite.config.ts` → `__DEMO_PERSONAS__`):
`pnpm dev`'de açık (`VITE_DEMO_PERSONAS=false` kapatır), `pnpm build`'de ortamdan bağımsız **her zaman
kapalı**; kapalıyken seçici ve persona verisi pakete hiç girmez.

- Kopya: `features/auth/demo/personas.ts`; gateway'in `personas.json`'ıyla aynı kaldığını
  `demo-personas.spec.ts` denetler.
- Paket taraması: `pnpm web:bundle:check` (CI'da "Paket taraması" adımı, `pnpm verify` içinde)
  `dist/`'te demo şifresini, personaların telefonunu (E.164 ve ulusal), kimliğini ve ad soyadını arar;
  değerleri `personas.json`'dan okur. Geliştirme kipinde derlenen paket bu taramada kalır.

## Teslimat adresi (T9.5) — tasarımsız kabuk

Ana sayfada arama kutusunun üstünde "Teslimat adresi" satırı. Yakındaki marketler (ana sayfada kategori
şeridinin altında ve `/markets`) ile genel arama **seçili adresin konumuyla** sorulur; adres değişince hemen
yenilenir. Kural veri katmanında, arayüz yalnızca çizer.

| Katman    | Dosya                                                            | İş                                                                                       |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Uç        | `features/address/api/addresses.api.ts`, `api/queries.ts`        | `GET /v1/me/addresses` (yetkili istemci); anahtar kullanıcıya bağlı, oturumsuz istek yok |
| Saf kural | `features/address/services/delivery-address.ts`                  | Bekle / varsayılan "Ev" (nedeniyle) / hesabın seçili ya da ilk adresi                    |
| Kalıcılık | `features/address/services/address-selection.ts`                 | `getir.address`: sürüm, okunan kaydın doğrulanması                                       |
| Depo      | `features/address/stores/useAddressStore.ts`                     | Zustand; saf fonksiyonları bağlar, kural yazmaz                                          |
| Hook'lar  | `useAddressBook`, `useDeliveryLocation`, `useAddressStorageSync` | Kaynaklar tek yerde (oturum, defter, seçim); sayfaların konumu; sekmeler arası eşitleme  |
| Kabuk     | `features/address/ui/AddressSelector.tsx`                        | Düğme ve hemen altında açılan liste (ad + adres satırı)                                  |

- **Kimin adresi:** oturumdaki hesabın adres defteri (T9.5 PR 2; en fazla 10, kayıt sırasında). Oturumsuz
  ziyaretçi varsayılan "Ev"i görür, altında "Adres seçmek için giriş yap" (dönüş bu sayfa, arama korunur).
  Adresi olmayan hesap "Kayıtlı adresin yok.", defteri okunamayan oturum sunucunun mesajını ve "Tekrar
  dene"yi görür; ikisi de varsayılan "Ev"i kullanır. Varsayılanın seed'deki "Ev" ile aynı kaldığını
  `delivery-address.spec.ts` denetler.
- **Seçim adıyla tanınır:** sözleşmede adres kimliği yok. `getir.address` = `{ userId, title }`, kalıcı;
  çıkışta silinmez, aynı kullanıcı dönünce seçimini bulur. Başka hesabın seçimi uygulanmaz; seçilen ad
  defterde yoksa ilk adres. Kayıt sürümlüdür ve okunurken doğrulanır (bozuk kayıt = seçim yok).
- **Önce doğru konum:** oturum ve defter çözülene kadar konuma bağlı sorgu **gitmez** (`skipToken`, konumu
  `null` olan ayrı sorgu anahtarı); bölümler "yükleniyor" gösterir. İstek önce varsayılan konuma gidip sonra
  değişmez (canlı testte 800 ms geciktirilen defterle ölçüldü).
- **Liste:** düğmenin hemen altında açılır, içeriği aşağı iter; seçim ya da Esc kapatır ve odak düğmeye
  döner. Kurye notu seçicide görünmez.
- **Sepet dokunulmaz:** adres değişince sepet aynı kalır; ürünün yeni adreste satılıp satılmadığına
  rezervasyon karar verir (T11.4).
- **Sekmeler arası:** bir sekmede seçilen adres diğerlerine `storage` olayıyla gelir (sepetle aynı yol).
- **Tek gözlemci:** defter seçicide, seçici durdukça bağlı tek gözlemciyle okunur; alt parçalar prop alır.
  Hata notu kendi gözlemcisini bağladığında TanStack okunamayan sorguyu yeniden başlatıyor, not kalkıp
  yeniden geliyor ve bu bitmiyordu (canlı testte bulundu). Hatadan sonraki yeniden denemede ("Tekrar dene",
  sekme odağı) konum varsayılanda kalır; bölümler "yükleniyor"a dönmez (`addressBookState`).
- **Sorgu ayarları hook'tan ayrı** (`api/queries.ts`: yakındaki marketler, genel arama, adres defteri):
  "konum/kullanıcı yokken istek gitmez, gelince tek istek" kuralı Node'da `QueryObserver` ve sahte `fetch`
  ile sınanır (`location-queries.spec.ts`); CI bu kuralı tarayıcısız korur.
- **Sekmeler arası sürüm:** başka sürümün yazdığı kayıt okunmaz (`shouldRehydrateAddress`); okunsaydı eski ve
  yeni sürümlü iki açık sekme birbirinin kaydını sonsuza dek ezerdi. Sepette aynı açık var (bekleyen iş).

## Sepet (T6.4, T7.6) — tasarımsız kabuk

Karar ve hesap **veri katmanında**, arayüz yalnızca çizer. Tasarım baştan değişse (düğmelerin yeri,
modal, çekmece, ayrı sepet sayfası) yalnızca `features/cart/ui/*` değişir; testlerin hepsi veri
katmanındadır.

| Katman       | Dosya                                                  | İş                                                                                   |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Saf kurallar | `features/cart/services/cart-state.ts`                 | Tek market + onay, adet (99 ya da stok) ve kalem (50) sınırı, satış durumu, `canAdd` |
| Kalıcılık    | `features/cart/services/cart-persistence.ts`           | `getir.cart`: sürüm, 24 saat, okunan kaydın doğrulanması                             |
| Toplam       | `features/cart/services/cart.service.ts`               | `@getir/pricing` `calculateCart`; kurallar **sepetin marketinden**                   |
| Depo         | `features/cart/stores/useCartStore.ts`                 | Zustand; saf fonksiyonları bağlar, kural yazmaz                                      |
| Hook'lar     | `useCartTotals`, `useAddToCart`, `useCartStorageSync`  | Toplam; onay bekleyen market değişimi; sekmeler arası eşitleme                       |
| Kabuk        | `ProductCartAction`, `CartSwitchPrompt`, `CartSummary` | Ekle / − adet +, onay satırı, özet                                                   |

- **Tek market:** sepette Migros ürünü varken A101'den eklemede ekleme **yapılmaz**, onay istenir:
  "Sepetinde Migros Jet – Moda ürünleri var. Sepeti boşaltıp A101 – Caferağa ile devam edilsin mi?"
  ("-den/-dan/-ndan" eki ada göre değiştiği için "ile" kullanıldı.)
- **Kalem teklif kimliğiyle (`offerId`) tanınır**, ürün kimliğiyle değil: aynı ürünün her markette aynı
  `prd_` kimliği var. Ürün kimliğiyle tanımak A101 sayfasında Migros sepetindeki adedi gösteriyor ve "−"
  Migros kalemini azaltıyordu (canlı denemede bulundu, regresyon testi var).
- **Toplam sepetin marketinin kurallarıyla:** A101'e bakarken sepet Migros'taysa Migros'un minimum
  sepeti ve teslimat ücreti uygulanır.
- **Katalog sepeti tanımaz:** ürün listesi yalnızca `renderAction` yuvası sunar; sepet düğmesini
  `MarketPage` yerleştirir.
- **Kalıcılık (T7.6):** sepet `localStorage`'da `getir.cart` anahtarında durur; yenilemede kalır.
  Son değişiklikten 24 saat sonra, sürüm değişince ya da kayıt bozuk/elle değiştirilmişse sessizce boş
  sepetle başlanır (okunan kayıt sözleşme şemalarıyla doğrulanır; localStorage güvenilmez girdidir).
- **Sekmeler arası (T7.6):** bir sekme sepeti değiştirince diğerleri `storage` olayıyla kaydı yeniden
  okur; iki sekme birbirinin eklediğini silmez.
- **Stok sınırı (T7.6):** "eklenebilir mi" sorusunun tek cevabı `canAdd`: stok bilgisi varsa
  `min(99, stok)`, yoksa 99. Stok T8.4'ten beri geliyor (gateway, B27). Stok servisi cevap vermezse
  alan gelmez ve sınır 99'a döner. "Son N adet" rozeti tasarımda (T16.3).
- **Tükendi (T8.4):** stoğu 0 olan teklifte "Ekle" yerine basılamayan "Tükendi" yazısı görünür
  ("Satışta değil" ile aynı kalıp ve stil). Karar `cart-state`'tedir (`isSoldOut`). Pasif teklif her
  zaman "Satışta değil" gösterir. Sepette zaten varsa adet düğmeleri kalır, "+" kapalı.
- **Market içi arama (T9.5):** market sayfasının üstündeki "Ürün ara…" kutusu. Yazım 300 ms durunca
  istek gider (`createDebouncer`), yeni arama eskisinin isteğini iptal eder (TanStack Query `signal`).
  2 harften kısa metin arama sayılmaz, istek gitmez (`searchQueryFrom`). Arama bütün markette yapılır:
  başlayınca kategori "Tümü"ne döner, kategori seçimi aramayı kaldırır. Arama adreste durur
  (`?ara=`): yenileme ve geri tuşu korur. Eşleşme sunucuda: harf ve Türkçe karakter duyarsız, çok
  kelimede her kelime (T9.4).
- **Genel arama (T9.6):** ana sayfada kategori şeridinin üstünde "Market ya da Ürün ara…" kutusu (aynı
  bileşen, `MarketSearchBox`; bekleme, 2 harf kuralı ve iptal market içi aramayla aynı). Arama varken
  şeridin yerinde sonuçlar durur, temizlenince şerit döner; arama adreste (`/?ara=`). İstek
  `GET /v1/search` (`features/search`), konum seçili teslimat adresinden (T9.5).
  - **Kart** (`SearchResultCard`): yakındaki market satırı (`NearbyMarketLine`, `/markets` listesiyle
    aynı: ad, "Kapalı" rozeti, puan, mesafe, süre, min. sepet), en fazla 3 ürün satırı (market
    sayfasındaki satır ve düğme: "Ekle", adet, "Tükendi") ve fazlası için "+N ürün daha" (market sayfası
    aynı aramayla, `marketPath(id, arama)`). Yalnızca adı eşleşen markette ürün satırı yoktur.
  - **Sepet:** sonuçtan eklenir. Sepet tek markettir: başka marketin ürünü eklenince onay sorusu o
    kartın içinde çıkar (`useAddToCart` kart başına). Kapalı market listede kalır, düğmeler market
    sayfasındaki gibi (bağlayıcı kontrol rezervasyonda, T11.4).
  - **Birleştirme sayfada:** arama kartı market satırını ve sepeti tanımaz; `HomePage` kartı market
    satırı (markets), ürünler ve sepet düğmeleri (catalog + cart, `SearchResultProducts`) ile kurar.
- **Satışta değil (T7.6):** pasif teklif (`isActive: false`) listede kalır, "Ekle" yerine basılamayan
  "Satışta değil" yazısı görünür ve sepete eklenemez. Sepette zaten varsa adet düğmeleri kalır, "+" kapalı.
- **Henüz yok:** iyimser güncellemenin geri alınması (rezervasyon "stok yetersiz / satışta değil"
  derse adet düzeltme + bildirim; T11.5), kupon alanı (T17.3), oturuma göre ilk sipariş koşulu (T8).

## Stil kuralları (D11)

- **Çıplak birim yok:** CSS modüllerinde `px`, `rem`, `em` yazılmaz; değer `tokens.css`'te işlevsel
  adla token olur, modül `var(--...)` kullanır. Kapı stylelint `unit-disallowed-list`
  (`tokens.css`, `global.css`, `breakpoints.css` hariç). Token adları ve değerleri kullanıcının
  kararıdır.
- **Kendi bloğu:** bileşen başka bloğun sınıfını ödünç almaz; ortak görünüm ortak bileşendir
  (`shared/ui/badge/Badge`: "Kapalı" rozeti, liste ve market başlığı birlikte kullanır).
- **Tanımsız sınıf yok:** `styles['c-yok']` TypeScript'te hata vermez, sessizce stilsiz kalır.
  `test/unit/css-module-classes.spec.ts` her bileşenin kullandığı sınıfın modülünde tanımlı
  olduğunu denetler.
- **"Görünüm aynı" ölçülerek:** D11'de değişiklik öncesi ve sonrası 7 sahne başsız Chrome'da
  çekildi, görüntüler bayt bayt aynı çıktı (yöntem D11 raporunda).

## Market ekranları (T5.4) — tasarımsız kabuk

Ekranların **görsel tasarımı kullanıcının kararıdır** ve zamanı gelince yapılacak (T16.2). Bu görev
yalnızca veri katmanını ve okunur bir kabuğu kurar; yeni görsel karar yoktur, mevcut token'lar kullanılır.

- **Konum:** seçili teslimat adresi (T9.5, `features/address`); oturumsuzken varsayılan "Ev".
- **Ana sayfa:** logo, teslimat adresi (T9.5), genel arama kutusu (T9.6), kategori şeridi ve yakındaki
  marketler (`/markets` ile aynı liste; ana sayfada başlığı h2). Market sayfası adresi ve parametreleri
  (`?kategori=`, `?ara=`) `features/markets/routes.ts`'te tek yerde.
- **Seçili kategori adreste** (`?kategori=`): yenileme ve paylaşma seçimi korur.
- **Stok gösterilmez:** `availableQuantity` bugün gelmiyor ("stok bilgisi yok"); sepet düğmeleri T6.4'te,
  "Satışta değil" durumu T7.6'da.
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

Giriş için gateway yeterlidir: `MOCK=true` iken demo personaları açılışta belleğe yüklenir
(`http://localhost:5173/giris`, persona seçiciden biri, "Giriş yap").

## Klasörler

```text
src/
  app/        router, QueryClient, sağlayıcılar
  pages/      rota başına sayfa kabuğu
  features/   özellik başına api + hook + ui (catalog, markets, cart, auth, search, address)
  shared/
    api/      http-client (gönder), envelope (zarf aç), idempotency-key, client (örnek)
    session/  oturum deposu, kilit, yenileyici, yetkili istemci (T8.5)
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

# apps/web

Müşteri arayüzü: React 18 + Vite + TypeScript. Tarayıcı yalnızca gateway ile konuşur (`/v1/*`).

## Bugünkü durum (T11.13 — favori marketler; T11.12 — market listesi; T11.7 — karşılama tanıtım bölümleri; T11.6 — karşılama ve giriş ekranı; T9.5 — teslimat adresi; T9.6 — genel arama; T8.5 — kimlik akışı; T7.6 — kalıcı sepet, stok sınırı, satışta olmayan teklif; T6.4 — sepet kabuğu)

| Parça                   | Durum                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite + React + router   | ✅ `/` oturumsuz: karşılama ekranı (T11.6); oturumda: market listesi (T11.12), genel arama (`?ara=`) · `/markets` (aynı liste) · `/markets/:id` |
| TanStack Query          | ✅ Yalnızca geçici hata (`SERVICE_UNAVAILABLE`) yeniden denenir; mutasyon denenmez                                                              |
| HTTP istemcisi          | ✅ Zarf açıcı → `AppError`; mutasyon `Idempotency-Key`'siz derlenmez (ADR-08)                                                                   |
| Idempotency key         | ✅ `crypto.randomUUID()`, sözleşmedeki uzunluk sınırıyla                                                                                        |
| Design token'lar        | ✅ `tokens.css`: marka paleti, Nunito, `clamp()` ölçeği, kapsayıcı, bileşen ölçüleri (D11)                                                      |
| Kırılımlar              | ✅ `@custom-media` (48rem / 64rem / 90rem), JS karşılığı `shared/config/breakpoints.ts`                                                         |
| Market veri hook'ları   | ✅ `useNearbyMarkets`, `useMarket`, `useMarketCategories`, `useMarketProducts` (imleçle sayfalı), `useNearbySearch` (T9.6)                      |
| Ortak durumlar          | ✅ `QueryStatus`: yükleniyor / hata / boş; \"Tekrar dene\" yalnızca geçici hatada                                                               |
| Zustand (sepet, oturum) | ✅ Sepet (`useCartStore`, `getir.cart`); seçili adres (`useAddressStore`, `getir.address`); oturum (bellekte)                                   |
| Kimlik (T8.5, T11.6)    | ✅ Karşılama kartında telefon → şifre / kayıt; `/hesabim` (korumalı); sessiz yenileme, sekmeler arası kilit (aşağıda)                           |
| Teslimat adresi (T9.5)  | ✅ Üst bardaki arama kutusunun sağ ucunda (T11.10); hesabın adresleri; marketler ve arama seçili adresin konumuyla (aşağıda)                    |
| Üst bar (T11.10)        | ✅ Mor, yapışkan: logo \| arama (içinde adres) \| Profil; telefonda iki satır (aşağıda)                                                         |
| Adres ekleme (T11.8)    | ✅ Adressiz hesap `/`'da karşılama ekranının üstünde iki adımlı pencere: harita (Leaflet + OSM) ve detay; kaydedince ana sayfa (aşağıda)        |

## Karşılama ve giriş ekranı (T11.6)

Oturumsuz ziyaretçinin `/` adresi (kullanıcının PRD'si + getirçarşı referansı, 2 Ekim kararları). Oturumdaki
kullanıcı aynı adreste ana sayfayı görür; kapı `pages/root/RootPage.tsx` (açılıştaki sessiz yenileme bitene kadar
hiçbir şey çizilmez, karşılama içeriği bu sürede paralel istenir). Giriş ve kayıt bu ekranın **üstünde pencere**
olarak açılır (getir.com gibi); adres `/giris` ve `/kayit` olur.

| Parça            | Dosya                                                                | İş                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| İçerik           | `features/content` (`GET /v1/content/welcome`)                       | Karşılama ekranı ve pencerelerin **bütün** metin ve görselleri; kodda sabit ekran metni yok                                                 |
| Üst bar          | `pages/welcome/WelcomeHeader.tsx`                                    | Mor bar: logo (sarı "getir" + beyaz "market", rozetsiz), "Giriş yap" ve "Kayıt ol" pencere açar                                             |
| Banner           | `pages/welcome/WelcomeHero.tsx`                                      | h1 görselin kendisi (slogan görselde, alt metin içerikten); `srcset` 960/1920/3200; karartma yok                                            |
| Telefon kartı    | `features/auth/ui/PhoneEntryForm.tsx`                                | "Devam Et" giriş penceresini numarayla açar; altında tek satırda "Şifremi unuttum \| Kayıt ol →" ve (geliştirmede) demo hesaplar            |
| Kategoriler      | `pages/welcome/WelcomeCategories.tsx`, `catalog/ui/CategoryGrid.tsx` | 13 kategori (CC0 görseller) ızgarada, mobil 3 sütun; tıklama giriş penceresini açar                                                         |
| İndirme bandı    | `pages/welcome/WelcomeAppDownload.tsx`                               | Açık zeminde mor kutu: başlık, alt metin, App Store / Google Play rozetleri (yeni sekme, `noopener`); telefonlar sağa ve alta yaslı (T11.7) |
| Tanıtım kutuları | `pages/welcome/WelcomeFeatures.tsx`                                  | Üç beyaz kutu: görsel (süs) + mor metin; telefonda alt alta, tablet ve üstünde yan yana (T11.7)                                             |
| Pencere          | `features/auth/ui/AuthDialog.tsx`                                    | `<dialog>` + `showModal`: odak pencerede, arka plan etkisiz; Esc, X ve karartmaya tıklama kapatır                                           |
| Giriş / kayıt    | `pages/login`, `pages/register` (+ `LoginForm`, `RegisterForm`)      | Karşılama ekranının üstünde pencere; altta gri bantta "Kayıt ol →" / "Giriş yap →" (`AuthSwitch`)                                           |
| Geçmiş durumu    | `features/auth/services/auth-route-state.ts`                         | Numara adrese yazılmaz, geçmiş kaydında taşınır; pencerenin uygulama içinden açıldığı bilgisi                                               |

- **Kapatma:** pencere uygulama içinden açıldıysa bir geri gidilir (geri tuşuyla aynı sonuç); adres doğrudan
  açıldıysa (yer imi, korumalı sayfanın yönlendirmesi) karşılama ekranına gidilir, korumalı sayfaya dönülmez
  (yeniden girişe yönlendirirdi). Pencereler arası geçiş adresi değiştirir (geçmiş büyümez).
- **Düzen:** telefonda ve 1440 px'e (`--bp-xl`, 90rem) kadar görsel kendi oranında üstte, kart altta. 1440 px ve
  üstünde kart banner'a biner, üst barla hizalı (geniş kapsayıcı, 80rem). Daha darda (1280, 1366) uzun kart banner'ı
  büyütür, görsel yaklaşır ve afişin yazısı kartın altında kalırdı (canlı ölçüm).
- **Odak:** karşılama ekranı açılınca hiçbir alan odaklanmaz (telefonda klavye kendiliğinden açılmasın). Giriş
  penceresi numara geldiyse şifreye, gelmediyse telefona; kayıt penceresi ad soyada odaklanır. `showModal`
  `useLayoutEffect`'te çağrılır ki tarayıcının "ilk odaklanabilir öğe" seçimi (X) formun odağını ezmesin.

## Görseller ve lisansları (T11.6)

`public/img/` altındaki dosyalar Vite'ın kökünden yayınlanır (`/img/...`); veri göreli yolu saklar, mutlak adresi
gateway `ASSET_BASE_URL` ile kurar. Banner (`img/banner/`, 960/1920/3200 px) ve bayrak (`img/flag/tr.svg`) bu proje
için hazırlandı. Kategori görselleri (`img/cat/`, 320×320 px, her biri 40 KB'ın altında) **CC0 1.0** lisanslı
fotoğraflardır (Openverse aramasıyla; atıf zorunlu değil, kaynak yine de burada).

Tanıtım bölümlerinin görselleri (T11.7) kullanıcının getir.com'dan sağladığı dosyalardır: telefonlar
(`img/landing/telefonlar.png`, 634×298; büyütülmez), tanıtım kutuları (`img/tanitim/teslimat.png`, `cesit.png`,
`dakikalar.png`, 300×300; getirçarşı markalı) ve mağaza rozetleri (`img/store/app-store.svg`, `google-play.svg`,
160×48). Rozet bağlantıları Getir'in App Store ve Google Play sayfasına gider (getir.com'daki rozetlerle aynı adres).

| Dosya               | Kategori          | Kaynak                                                                                            | Yazar             | Lisans  |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------- | ----------------- | ------- |
| `sut.jpg`           | Süt & Kahvaltılık | [stocksnap](https://stocksnap.io/photo/milk-bottle-YFZUAHJV1M)                                    | Foodie Girl       | CC0 1.0 |
| `manav.jpg`         | Meyve & Sebze     | [stocksnap](https://stocksnap.io/photo/fruit-vegetables-F8B73CPSBK)                               | Jamie Hamel-Smith | CC0 1.0 |
| `icecek.jpg`        | İçecek            | [rawpixel](https://www.rawpixel.com/image/8718218/glass-orange-juice)                             | —                 | CC0 1.0 |
| `atistirmalik.jpg`  | Atıştırmalık      | [rawpixel](https://www.rawpixel.com/image/5904291/photo-image-public-domain-food-free)            | —                 | CC0 1.0 |
| `temizlik.jpg`      | Temizlik          | [rawpixel](https://www.rawpixel.com/image/5903626/cleaning-products-free-public-domain-cc0-photo) | —                 | CC0 1.0 |
| `firindan.jpg`      | Fırından          | [rawpixel](https://www.rawpixel.com/image/5970492/bread-loaf)                                     | —                 | CC0 1.0 |
| `temel-gida.jpg`    | Temel Gıda        | [rawpixel](https://www.rawpixel.com/image/5907896/image-public-domain-food-free)                  | —                 | CC0 1.0 |
| `et-tavuk.jpg`      | Et & Tavuk        | [rawpixel](https://www.rawpixel.com/image/6034675/raw-meat-free-public-domain-cc0-photo)          | —                 | CC0 1.0 |
| `dondurma.jpg`      | Dondurma          | [stocksnap](https://stocksnap.io/photo/icecream-gelato-E7125AED61)                                | JESHOOTS.com      | CC0 1.0 |
| `kisisel-bakim.jpg` | Kişisel Bakım     | [rawpixel](https://www.rawpixel.com/image/5947458/free-public-domain-cc0-photo)                   | —                 | CC0 1.0 |
| `ev-yasam.jpg`      | Ev & Yaşam        | [rawpixel](https://www.rawpixel.com/image/6020086/photo-image-public-domain-kitchen-free)         | —                 | CC0 1.0 |
| `bebek.jpg`         | Bebek             | [rawpixel](https://www.rawpixel.com/image/5913298/image-background-public-domain-hand)            | —                 | CC0 1.0 |
| `evcil-hayvan.jpg`  | Evcil Hayvan      | [rawpixel](https://www.rawpixel.com/image/5958959/free-public-domain-cc0-photo)                   | —                 | CC0 1.0 |

Market kapakları (T11.11, `img/market/`, 640×360 px, her biri 60 KB'ın altında) dükkân türüne göredir: aynı türdeki
marketler aynı kapağı kullanır, veri `coverUrl` alanında `/img/market/<tür>.jpg` yolunu saklar. Logo yoktur; liste
kartı marketin baş harflerini rozet olarak gösterir. Hepsi **CC0 1.0** (Openverse aramasıyla).

| Dosya           | Dükkân türü | Kaynak                                                                                                | Yazar          | Lisans  |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------- | -------------- | ------- |
| `market.jpg`    | Market      | [rawpixel](https://www.rawpixel.com/image/6082112/vegetables-supermarket)                             | —              | CC0 1.0 |
| `manav.jpg`     | Manav       | [rawpixel](https://www.rawpixel.com/image/447819/free-photo-image-supermarket-produce-farmers-market) | Jakub Kapusnak | CC0 1.0 |
| `kasap.jpg`     | Kasap       | [rawpixel](https://www.rawpixel.com/image/5975314/butcher-shop)                                       | —              | CC0 1.0 |
| `sarkuteri.jpg` | Şarküteri   | [rawpixel](https://www.rawpixel.com/image/5917446/image-public-domain-food-free)                      | —              | CC0 1.0 |
| `kuruyemis.jpg` | Kuruyemiş   | [rawpixel](https://www.rawpixel.com/image/5912517/image-public-domain-plant-wooden)                   | —              | CC0 1.0 |
| `firin.jpg`     | Fırın       | [rawpixel](https://www.rawpixel.com/image/6028941/photo-image-public-domain-food-free)                | —              | CC0 1.0 |
| `petshop.jpg`   | Pet shop    | [rawpixel](https://www.rawpixel.com/image/5926065/photo-image-background-public-domain-dog)           | —              | CC0 1.0 |
| `cicekci.jpg`   | Çiçekçi     | [rawpixel](https://www.rawpixel.com/image/5974957/photo-image-flower-lights-leaves)                   | —              | CC0 1.0 |

## Kimlik akışı (T8.5)

Giriş (`/giris`) ve kayıt (`/kayit`) T11.6'dan beri karşılama ekranının üstünde pencere (yukarıda). Kurallar ve alan mesajları sözleşmeden; göster/gizle düğmeli şifre; "Şifremi unuttum" ve sosyal
girişler yok. Diğer sayfaların başlığında oturumsuzken "Giriş yap" (dönüş adresiyle), oturumdayken "Hesabım"
(dar ekranda yalnızca ikon).

| Katman          | Dosya                                                                   | İş                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oturum deposu   | `shared/session/session-store.ts`                                       | `unknown` / `anonymous` / `authenticated`; erişim jetonu **yalnızca bellekte**                                                                                                                                                                                                                                                                                                                                      |
| Kilit           | `shared/session/session-lock.ts`                                        | Yenileme, giriş, kayıt, çıkış bütün sekmelerde sırayla (Web Locks, `getir-oturum`)                                                                                                                                                                                                                                                                                                                                  |
| Yenileyici      | `shared/session/session-refresher.ts`                                   | Sekme içinde tek uçuş; 401 → oturumsuz; geçici hata fırlatılır, oturum yerinde kalır                                                                                                                                                                                                                                                                                                                                |
| Yetkili istek   | `shared/session/authorized-client.ts`                                   | `Bearer` ekler; 401'de **bir kez** yeniler ve **bir kez** tekrarlar (döngü yok)                                                                                                                                                                                                                                                                                                                                     |
| Açılış          | `shared/session/restore-session.ts` (`main.tsx`)                        | Sayfa yenilenince bir kez sessiz yenileme; herkese açık sayfa beklemez                                                                                                                                                                                                                                                                                                                                              |
| Formlar         | `features/auth/services/form-schemas.ts`, `ui/*Form.tsx`                | react-hook-form + zodResolver; kurallar ve alan mesajları `@getir/contracts`'tan                                                                                                                                                                                                                                                                                                                                    |
| Sunucu hatası   | `features/auth/services/server-errors.ts`                               | Alan altına / form üstüne; metin sözlükten; 429'da kalan saniye                                                                                                                                                                                                                                                                                                                                                     |
| Numara kontrolü | `features/auth/hooks/usePhoneRegistration.ts`, `ui/PhoneNotice.tsx`     | Numara tamamlanınca (300 ms sonra, iptal edilebilir) `POST /v1/auth/phone-check`; kayıtta "hesap var → Giriş yap", girişte "hesap yok → Kayıt ol" (T11.7)                                                                                                                                                                                                                                                           |
| Alanlar         | `features/auth/ui/PhoneField.tsx`, `PasswordField.tsx`, `AuthField.tsx` | Bütün telefon ve şifre alanları bunlardan (giriş, kayıt, şifremi unuttum, profilde numara değiştirme). T11.16: telefonda ipucu yok, boş alanda etiket ("Telefon Numarası") kutunun içinde, değer girilince üste kayar (`floatingLabel`, `:placeholder-shown`); göz simgesi durumu gösterir (görünürken açık, gizliyken üstü çizili), adı bir sonraki eylem ("Şifreyi göster" / "Şifreyi gizle"), `aria-pressed` yok |
| Cep numarası    | `features/auth/services/form-schemas.ts` (`earlyPhoneProblem`)          | Türkiye cep numarası 5 ile başlar (BTK: 5XX + 7 rakam); ilk rakam yanlışsa numara bitmeden sözleşmenin cümlesi, eksiklik gönderimde (T11.9)                                                                                                                                                                                                                                                                         |
| Şifremi unuttum | `pages/forgot-password`, `ui/ResetPasswordForm.tsx`                     | **Yalnızca geliştirmede** (`__DEMO_PASSWORD_RESET__`): telefon + yeni şifre, kod yok; yenileme oturum açar, eski oturumlar kapanır (T11.9)                                                                                                                                                                                                                                                                          |
| Dönüş adresi    | `features/auth/services/next-path.ts`                                   | `?next=` yalnızca uygulama içi yol (`//site`, `/\site`, mutlak adres → ana sayfa)                                                                                                                                                                                                                                                                                                                                   |
| Koruma          | `features/auth/ui/RequireAuth.tsx`                                      | Oturum yoksa `/giris?next=...`; girişle geri döner                                                                                                                                                                                                                                                                                                                                                                  |

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

### Demo hesaplar (yalnızca geliştirme)

Karşılama kartının ve giriş penceresinin altında katlanır "Demo hesaplar": Ayşe, Zeynep, Can, Ali ve Komşu. Kartta
açılır menüdür (kart uzamaz) ve seçim giriş penceresini telefon ve şifre dolu açar; geçmiş durumu yalnızca "demo"
işaretini taşır, şifreyi giriş sayfası (yalnızca geliştirme paketinde) kendisi doldurur. Seçilen hesap formu telefon ve demo şifresiyle **doldurur**, girişi kullanıcı yapar. Bayrak derleme zamanıdır (`vite.config.ts` → `__DEMO_PERSONAS__`):
`pnpm dev`'de açık (`VITE_DEMO_PERSONAS=false` kapatır), `pnpm build`'de ortamdan bağımsız **her zaman
kapalı**; kapalıyken seçici ve persona verisi pakete hiç girmez.

- Kopya: `features/auth/demo/personas.ts`; gateway'in `personas.json`'ıyla aynı kaldığını
  `demo-personas.spec.ts` denetler.
- Paket taraması: `pnpm web:bundle:check` (CI'da "Paket taraması" adımı, `pnpm verify` içinde)
  `dist/`'te demo şifresini, personaların telefonunu (E.164 ve ulusal), kimliğini ve ad soyadını arar;
  değerleri `personas.json`'dan okur. Geliştirme kipinde derlenen paket bu taramada kalır.

## Adres ekleme (T11.8)

Oturum açık ama kayıtlı adres yoksa (yeni kayıt da, adressiz eski hesap da) `/` karşılama ekranının **üstünde**
adres penceresi açar (referans getir.com "Teslimat Adresi Ekle"). Kapının kararı `features/address/services/address-gate.ts`:
oturum ve defter belli olana kadar hiçbir şey çizilmez (adresi olan kullanıcı pencereyi bir an görmez); defter
okunamazsa ana sayfa açılır.

| Parça        | Dosya                                                         | İş                                                                                                                            |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Kapı         | `pages/root/RootPage.tsx`, `pages/address-setup`              | Karşılama / adres ekleme / ana sayfa; pencere karşılama ekranının üstünde                                                     |
| Pencere      | `features/address/ui/AddressSetupDialog.tsx`, `AddressDialog` | İki adım; 1. adımda X (ve Esc) **çıkış**, 2. adımda X yerine geri oku (Esc de geri). Karartmaya tıklama kapatmaz              |
| 1. adım      | `AddressMapStep`, `AddressSearch`, `AddressMap`               | Arama (gönderince sorulur), ortasında pin olan harita, "Bu adresi kullan" (nokta seçilene kadar pasif); "Konumumu kullan" yok |
| 2. adım      | `AddressDetailsForm`, `KindSelect`                            | Önizleme haritası, tür + başlık, satır (haritadan dolu), bina/kat/daire, tarif; market yoksa uyarı (kaydı engellemez)         |
| Uçlar        | `api/addresses.api.ts`, `api/geo.api.ts`, `api/queries.ts`    | `POST /v1/me/addresses` (anahtar niyet başına), `GET /v1/geo/reverse`, `GET /v1/geo/search` (yetkili istemci)                 |
| Saf kurallar | `services/address-form.ts`, `line-notice.ts`                  | Form şeması (sözleşmeden), türle gelen başlık, istek gövdesi; satır bulunamadığında uyarı                                     |

- **Harita:** Leaflet ve OpenStreetMap karoları; karo adresi, atıf ve başlangıç noktası içerik ucundan
  (`addressSetup.map`). Leaflet **ayrı pakette** yüklenir (`LazyAddressMap`): yalnızca adres ekleyen kullanıcı
  indirir. Pin sayfanın öğesidir (marker görseli yok), harita onun altında kayar.
- **Adres servisi gateway'de:** tarayıcı Nominatim'e gitmez; gateway tek sırayla (saniyede bir) ve önbellekle
  sorar. Aynı nokta ikinci kez sorulmaz (sorgu önbelleği). Adres bulunamazsa (404) ya da servis yoğunsa (503) 2. adım yine açılır, satırı kullanıcı yazar.
- **Kaydet:** cevap güncel defterdir, sorgu önbelleğine yazılır ve yeni adres seçilir (`getir.address`); kapı
  ana sayfaya geçer. Anahtar `createIntentKeys`: aynı gövdenin tekrarı aynı anahtar, düzeltilen gövde yeni
  anahtar (409 CONFLICT yaşanmaz). Aynı ad başlığın altında, dolu defter formun üstünde gösterilir.

## Üst bar (T11.10)

Oturumlu sayfaların (ana sayfa, `/markets`, market sayfası, `/hesabim`) mor, yapışkan barı; referans
getirçarşı. Karşılama ekranının barıyla aynı renk; logo sarı "getir" + beyaz "market". Metinler içerik ucundan
(`appHeader`).

| Parça           | Dosya                                                                  | İş                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| İskelet         | `shared/ui/page-layout/PageLayout.tsx`, `header-slot.ts`               | Tek satır: logo \| arama \| hesap. Telefonda iki satır: üstte logo + hesap, altta tam genişlik arama                                                                                                                       |
| Birleştirme     | `app/AppHeader.tsx`, `app/AppShell.tsx`                                | Yuvaları doldurur: arama adresi tanımaz, adres giriş yolunu tanımaz                                                                                                                                                        |
| Arama           | `features/search/ui/HeaderSearch.tsx`, `services/search-route`         | Ana sayfada yazdıkça `?ara=`; başka sayfada Enter ana sayfadaki sonuçlara götürür                                                                                                                                          |
| Adres           | `features/address/ui/HeaderAddressPicker.tsx`, `AddressBookDialog.tsx` | Kutunun sağ ucunda "🏠 Ev ›" (teslimat süresi yok); tıklayınca "Adreslerim" penceresi (radyo + "Adresi Onayla"); alt banttaki "Adres Ekle" T11.8'in harita + detay penceresini açar (X yalnızca kapatır, detayda geri + X) |
| Profil          | `features/auth/ui/HeaderAccount.tsx`                                   | Menü: hesap sayfaları (sol menüyle aynı liste, T11.16) ve altta ayrı satırda "Çıkış yap"; oturumsuzken "Giriş yap"                                                                                                         |
| Açılır listeler | `shared/ui/disclosure/useDisclosure.ts`                                | Esc, dışarı tıklama ve seçim kapatır; odak düğmeye döner                                                                                                                                                                   |

- **Neden başka sayfada Enter:** yazarken ana sayfaya geçilseydi bar yeniden kurulur, klavye odağı kaybolurdu.
  Oturumsuz ziyaretçinin Enter'ı giriş ekranına gider, dönüş arama sonuçlarıdır (`app/header-search-href.ts`;
  ana sayfası karşılama ekranı olduğu için arama orada kaybolurdu).
- **Odak halkası:** mor barda beyaz; beyaz arama kutusunda mor ve kutunun içine çizilir; adres pencereleri ve
  Profil menüsü gibi beyaz panellerde mor (halka kaldırılmaz, rengi değişir; değişken kalıtılır, başka bloğa seçici
  yazılmaz).
- **Metinler:** logo ve bütün bar metinleri içerikten (`header.brand/service`, `appHeader`); varsayılan adresin adı
  "Ev" türünün etiketi (`services/delivery-label.ts`).
- **İçerik gelmezse:** logo ve Profil menüsü içerik yedeğiyle (`@getir/contracts` `CONTENT_FALLBACK`; değerler
  `welcome.json` ile aynı, test karşılaştırır), arama kutusunun yerinde hata mesajı ve "Tekrar dene". Oturumdaki
  kullanıcı her durumda çıkış yapabilir ve Hesabım'a gidebilir.

## Market listesi (T11.12)

Ana sayfa (oturumda, `?ara=` yokken) ve `/markets` aynı ekranı kullanır; referans getirçarşı işletme listesi.
Ana sayfanın ürün kategorileri şeridi kalktı (karşılama ekranının kategori ızgarası yerinde).

| Bölge           | Dosya                                                                  | İş                                                                                                       |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Ekran           | `pages/markets/MarketListingScreen.tsx`                                | Birleştirir: liste (markets) sepeti, sepet (cart) market adreslerini tanımaz; Sepetim sağ sütun yuvasına |
| Düzen           | `features/markets/ui/MarketListing.tsx`, `MarketListingView.tsx`       | ≥64rem üç sütun (1:2:1); altında tek sütun, menünün yerine çip satırı                                    |
| Kategoriler     | `features/markets/ui/StoreTypeMenu.tsx`, `StoreTypeChips.tsx`          | Akordeon gruplar (küçük görsel, ok); açılınca adresteki sayılarıyla türler, tıklayınca süzer             |
| Kart            | `features/markets/ui/MarketCard.tsx`                                   | Kapak + baş harf rozeti (logo yok), ad, puan, süre, min. tutar, ücretsiz teslimat eşiği, Kapalı          |
| Sepetim         | `features/cart/ui/CartPanel.tsx`, `CartPanelView.tsx`, `CartBar.tsx`   | Genişte sağ panel (boş ya da dolu); telefon ve tablette altta sabit çubuk, yalnızca sepet doluyken       |
| Süzgeç ve sayım | `features/markets/services/store-type-filter.ts`, `market-initials.ts` | `?tur=kasap` ↔ `KASAP`; adreste marketi olmayan tür ve grup gösterilmez; sıra yakından uzağa             |

- **Gruplar ve tür adları içerikten:** `marketList.groups` (hangi tür hangi grupta) ve `storeTypes` gateway'in
  `welcome.json`'ında; kodda sabit yok. Her tür tam bir gruptadır, adı tam bir kez yazılır (sözleşme ve gateway
  denetler). Grup görselleri mevcut kapaklardır (`img/market/`, yukarıdaki lisans tablosu).
- **İçerik gelmezse** liste içerik yedeğiyle (`CONTENT_FALLBACK.marketList`) çalışır; değerler `welcome.json`
  ile aynıdır (contracts testi).
- **Seçim adreste** (`?tur=`): geri tuşu bir önceki süzgece döner, adres paylaşılabilir. Bilinmeyen değer
  süzgeç yok sayılır. Türü bilinmeyen market (eski catalog-service) yalnızca süzgeçsiz listede görünür.
- **Sepetim:** hesap `@getir/pricing`'te (`useCartTotals`); "Sepete git" sepet sayfasına (`/sepet`, T16.3) gider.
- Favori, görünüm düğmeleri ve indirim rozeti yok (veri yok; T11.11 kararı 4).

## Favori marketler (T11.13)

Referans getirçarşı "Favori İşletmelerim". Kayıt sunucuda (gateway, kullanıcı belgesi; en fazla 50): başka
cihazda da aynı favoriler.

| Parça            | Dosya                                                     | İş                                                                                                   |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Kalp             | `features/favorites/ui/FavoriteButton.tsx`                | Kapağın sağ üstünde; boşken beyaz çizgi, favoriyken içi marka moru; `aria-pressed`, adı duruma göre  |
| Veri             | `features/favorites/api`, `hooks/useFavorites.ts`         | `GET /v1/me/favorites` (TanStack Query, kullanıcı kimliğiyle anahtarlı); kalpler ve sayfa aynı sorgu |
| Tıklama          | `hooks/useToggleFavorite.ts`, `services/favorite-list.ts` | İyimser: liste hemen değişir; sunucu reddederse eski hali geri yazılır ve bildirim çıkar             |
| Bildirim (toast) | `shared/toast/`, `shared/ui/toast/Toaster.tsx`            | Zustand kuyruğu (en fazla 3, 5 sn), `aria-live`; roadmap T15.4'ten öne alındı                        |
| Profil sayfası   | `pages/account/AccountLayout.tsx`, `FavoritesPage.tsx`    | Solda profil kartı ve hesap menüsü (aşağıda "Hesap menüsü"); `/hesabim/favoriler`                    |
| Kart             | `features/markets/ui/MarketCard.tsx`                      | Bağlantı market adında, katmanı kartı kaplar; kalp bağlantının dışında (iç içe etkileşim geçersizdi) |

- **Metinler içerikten** (`favorites` bloğu; menü etiketleri T11.16'dan beri `accountMenu`); içerik gelmezse yedekle.
- **"Adreslerim"** profil menüsünde `/hesabim/adreslerim` sekmesine gider (T11.15; aşağıda "Adreslerim sekmesi").
  Üst bardaki adres seçici kendi penceresini açmaya devam eder (`features/address/ui/AddressDialogs.tsx`).
- Açılış saati verisi yok: kapalı market yalnızca "Kapalı" etiketiyle görünür.

## Teslimat adresi (T9.5) — tasarımsız kabuk

T11.10'dan beri üst bardaki arama kutusunun sağ ucunda (yukarıda); önce ana sayfada arama kutusunun
üstündeydi. Market listesi (ana sayfa ve `/markets`, T11.12) ile genel arama **seçili adresin konumuyla**
sorulur; adres değişince hemen yenilenir. Kural veri katmanında, arayüz yalnızca çizer.

| Katman    | Dosya                                                            | İş                                                                                       |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Uç        | `features/address/api/addresses.api.ts`, `api/queries.ts`        | `GET /v1/me/addresses` (yetkili istemci); anahtar kullanıcıya bağlı, oturumsuz istek yok |
| Saf kural | `features/address/services/delivery-address.ts`                  | Bekle / varsayılan "Ev" (nedeniyle) / hesabın seçili ya da ilk adresi                    |
| Kalıcılık | `features/address/services/address-selection.ts`                 | `getir.address`: sürüm, okunan kaydın doğrulanması                                       |
| Depo      | `features/address/stores/useAddressStore.ts`                     | Zustand; saf fonksiyonları bağlar, kural yazmaz                                          |
| Hook'lar  | `useAddressBook`, `useDeliveryLocation`, `useAddressStorageSync` | Kaynaklar tek yerde (oturum, defter, seçim); sayfaların konumu; sekmeler arası eşitleme  |
| Kabuk     | `features/address/ui/HeaderAddressPicker.tsx`                    | Üst bardaki düğme ve "Adreslerim" penceresi (radyo + onay, Adres Ekle)                   |

- **Kimin adresi:** oturumdaki hesabın adres defteri (T9.5 PR 2; en fazla 10, kayıt sırasında). Oturumsuz
  ziyaretçi varsayılan "Ev"i görür; düğme giriş ekranına götürür (dönüş bu sayfa, arama korunur).
  Adresi olmayan hesap "Kayıtlı adresin yok.", defteri okunamayan oturum sunucunun mesajını ve "Tekrar
  dene"yi görür; ikisi de varsayılan "Ev"i kullanır. Varsayılanın seed'deki "Ev" ile aynı kaldığını
  `delivery-address.spec.ts` denetler.
- **Seçim kimlikle tanınır (T11.15):** `getir.address` sürüm 2 = `{ userId, addressId }`, kalıcı; çıkışta
  silinmez, aynı kullanıcı dönünce seçimini bulur. Ad değişse de seçim kalır. Sürüm 1 kaydı (`{ userId, title }`)
  atılmaz: defter gelince adla eşleşip kimliğe çevrilir. Başka hesabın seçimi uygulanmaz; seçilen adres defterde
  yoksa (silinmiş) ilk adres. Kayıt sürümlüdür ve okunurken doğrulanır (bozuk kayıt = seçim yok).
- **Önce doğru konum:** oturum ve defter çözülene kadar konuma bağlı sorgu **gitmez** (`skipToken`, konumu
  `null` olan ayrı sorgu anahtarı); bölümler "yükleniyor" gösterir. İstek önce varsayılan konuma gidip sonra
  değişmez (canlı testte 800 ms geciktirilen defterle ölçüldü).
- **Adreslerim:** pencere; seçim "Adresi Onayla"ya kadar uygulanmaz, X ve Esc değiştirmeden kapatır. Aynı adla
  ikinci adres olmadığı için ekleme formu boşta olan adı önerir ("Ev 2"). Kurye notu seçicide görünmez.
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

| Katman       | Dosya                                                          | İş                                                                                     |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Saf kurallar | `features/cart/services/cart-state.ts`                         | Tek market + onay, adet (99 ya da stok) ve kalem (50) sınırı, satış durumu, `canAdd`   |
| Kalıcılık    | `features/cart/services/cart-persistence.ts`                   | `getir.cart`: sürüm, 24 saat, okunan kaydın doğrulanması                               |
| Toplam       | `features/cart/services/cart.service.ts`                       | `@getir/pricing` `calculateCart`; kurallar **sepetin marketinden**                     |
| Depo         | `features/cart/stores/useCartStore.ts`                         | Zustand; saf fonksiyonları bağlar, kural yazmaz                                        |
| Hook'lar     | `useCartTotals`, `useAddToCart`, `useCartStorageSync`          | Toplam; onay bekleyen market değişimi; sekmeler arası eşitleme                         |
| Düğmeler     | `ProductCartAction`, `CartQuantityStepper`, `CartSwitchPrompt` | "+" ya da adet kutusu (ürün kartında dikey, arama satırında yatay; T16.2), onay satırı |

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
  market listesinin yerinde sonuçlar durur, temizlenince liste döner; arama adreste (`/?ara=`). İstek
  `GET /v1/search` (`features/search`), konum seçili teslimat adresinden (T9.5).
  - **Kart** (`SearchResultCard`): yakındaki market satırı (`NearbyMarketLine`: ad, "Kapalı" rozeti,
    puan, mesafe, süre, min. sepet), en fazla 3 ürün satırı (market
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

## Mağaza sayfası (T16.2)

`/markets/:marketId`; referans getirçarşı işletme sayfası. Sayfa birleştirir: katalog sepeti, sepet katalogu,
markets favorileri tanımaz.

| Bölge         | Dosya                                                                        | İş                                                                                     |
| ------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Ekran         | `pages/market/MarketPage.tsx`                                                | ≥64rem solda sayfa, sağda başlıksız Sepetim (3:1); altında tek sütun ve sepet çubuğu   |
| Baş           | `features/markets/ui/MarketHeroSection.tsx`, `MarketHero.tsx`, `RatingStars` | Kapak + baş harf rozeti, ad, yıldızlar ve puan, kalp, süre ve min., açık/kapalı, rozet |
| Hakkında      | `features/markets/ui/MarketAboutDialog.tsx`                                  | Marka, süre, minimum sepet, teslimat ücreti, ücretsiz teslimat eşiği                   |
| Kategoriler   | `features/catalog/ui/MarketCategoryNav.tsx`                                  | Genişte dikey liste (görsel, ad, ok), dar ekranda kayan şerit; başta "Tümü"            |
| Ürünler       | `MarketCatalogSection.tsx`, `MarketProductGrid.tsx`, `ProductCard.tsx`       | Başlık (kategori, "Tüm Ürünler" ya da "Arama Sonuçları"), kart ızgarası, "Daha fazla"  |
| Sepet düğmesi | `features/cart/ui/ProductCartAction.tsx`                                     | "+"; sepetteyse Sepetim'in adet kutusu (dikey); ana sayfa aramasında aynı düğme yatay  |

- **Metinler içerikten:** `marketPage` bloğu; puan, "Min.", "Kapalı", eşik, "Kategoriler", "Tümü" ve adet kutusunun
  adları market listesiyle ortak (`marketList`). İçerik gelmezse yedek (`CONTENT_FALLBACK.marketPage`).
- **Veri olmayanlar (B3, backend):** kapanış saati (yerine açık/kapalı), ürün görsel dosyaları (kartın görseli ürünün
  kategorisinin; `product.imageUrl` istenmez, her ürün 404 verirdi), alt kategori (katalog düz) ve indirim verisi.
- **Teslimat satırı etiketsiz** ("15-25 dk · Min. 40,00 TL"): kuryeyi platform atar (T13), "İşletme getirsin" değil.

## Sepet sayfası (T16.3)

`/sepet`; referans getirçarşı sepet sayfası. Oturum ister (girişle geri döner, `?next=/sepet`). Sepetim panelinin ve
sepet çubuğunun "Sepete git"i buraya gelir.

| Bölge        | Dosya                                                                            | İş                                                                                         |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Ekran        | `pages/cart/CartPage.tsx`, `CartScreen.tsx`                                      | Sade bar + alt bilgi; ≥64rem solda sepet, sağda adres ve toplam (7:3); boş sepet           |
| Sade bar     | `shared/ui/page-layout/PageLayout.tsx` (`variant="minimal"`), `DeliveryTimeChip` | Logo, beyaz kutuda teslimat adresi, sarı "TVS 20-30 dk" (sepetin marketi); arama yok       |
| Sepet kutusu | `features/cart/ui/CartItemsCard.tsx`, `CartPageItem.tsx`                         | Mağaza (bağlantı), satır: kategori görseli, ad, mor tutar, "Son N adet", adet kutusu       |
| Toplam       | `features/cart/ui/CartTotalsCard.tsx`                                            | "Sepet Tutarı", minimum sepete ve ücretsiz teslimata kalan, "Ödemeye Geç" (F4'e dek pasif) |
| Adres        | `features/address/ui/DeliveryAddressSection.tsx`, `services/address-text.ts`     | Üst bardaki seçimle aynı adres; satır, bina, kat, daire                                    |
| Alt bilgi    | `shared/ui/site-footer/SiteFooter.tsx`                                           | Telif satırı; sosyal ikon ve bağlantı gerçek adresler gelene kadar yok                     |

- **"Son N adet"** (`shared/services/low-stock.ts`, N = 5): ürün kartında stok, sepet satırında kalemin stok sınırı.
  Bilgi amaçlı; bağlayıcı kontrol rezervasyonda (ADR-13).
- **Satırın görseli** kategorinin (ürün görselleri yok, B3): kalem eklenirken kategorisi yazılır (`categoryId`, isteğe
  bağlı; eski sepetler korunur). Satır sonunda ayrı çöp kutusu yok (referans).
- **Metinler içerikten:** `cartPage` ve `footer` blokları; onay penceresi, adet kutusu, boş sepet ve minimum sepet
  metinleri Sepetim paneliyle ortak (`marketList.cart`).

## Ödeme sayfası (T17.1)

`/odeme`; referans getirçarşı ödeme sayfası, **kampanya yok**. Sepet sayfasının "Ödemeye Geç"i buraya gelir (minimum
sepet tutmazsa pasif). Oturum ister; sepet boşsa `/sepet`'e döner. Sade bar ve alt bilgi sepet sayfasıyla aynı.

| Bölge                  | Dosya                                                                                       | İş                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Ekran                  | `pages/checkout/CheckoutPage.tsx`, `CheckoutScreen.tsx`                                     | Solda bölümler, sağda adres ve özet (7:3); form hataları alan terk edilince                             |
| Hediye                 | `features/checkout/ui/GiftSection.tsx`, `PresetNoteDialog.tsx`                              | Evet/Hayır anahtarı, hazır notlar, not (0/250), gönderen, zorunlu alıcı adı ve telefonu                 |
| Teslimat ve not        | `DeliveryMethodSection.tsx`, `NoteSection.tsx`                                              | Tek seçili seçenek (etiketsiz); sipariş notu (0/250) ve "Zili Çalma"                                    |
| Ödeme yöntemi          | `hooks/useSelectedCard.ts`, `ui/PaymentMethodView.tsx`                                      | Seçilen kart (geçerliyse), yoksa süresi geçmemiş en yeni kart; "Değiştir" ve "Kart ekle" pencereyi açar |
| Ödeme yöntemi seç (F5) | `ui/PaymentMethodDialog.tsx`, `PaymentMethodList.tsx`, `services/method-dialog.ts`          | Tek pencere, üç adım: liste (radyo grubu), kart ekleme (`AddCardForm variant="checkout"`), silme onayı  |
| Sipariş akışı (T12.4)  | `hooks/useCheckoutOrder.ts`, `useOrderFlow.ts`, `services/place-order.ts`, `order-draft.ts` | Rezervasyon → sipariş (taslak gövde) → 3DS; başarıda sepet boşalır, sipariş detayına gidilir            |
| 3DS (T12.4)            | `ui/ThreeDsStep.tsx`, `ThreeDsDialog.tsx`, `services/countdown.ts`                          | 6 haneli kod, geri sayım (son 30 sn uyarı), kalan hak; Vazgeç/süre dolunca rezervasyon bırakılır        |
| Özet                   | `OrderSummaryCard.tsx`, `AgreementField.tsx`                                                | Sepet Tutarı, Teslimat Ücreti, Ödenecek Tutar; sözleşme onayı; "Sipariş Ver" (pasif)                    |
| Kurallar               | `features/checkout/services/checkout-rules.ts`, `selected-card.ts`                          | B2 taslağı: not ≤250, ad ≤60, alıcı adı ve cep telefonu zorunlu (hediye açıkken)                        |

- **Kart kasası production paketinde kapalı** (`__CARD_VAULT__`, K1 (a)): kart bölümü orada kart okumaz ("Kayıtlı
  kartın yok"); kasa açılana kadar production'da sipariş verilemez. Kasanın ucu paket taramasıyla denetlenir.
- **Ödeme Yöntemi Seç (F5, T17.1):** "Online Ödeme" altında kayıtlı kartlar radyo grubu (ok tuşları tarayıcının);
  süresi geçmiş kart listede ama seçilemez, silinebilir; seçili kartın yanında "Kartı Sil" (onaylı). "+ Kredi/Banka
  Kartı" Ödeme Yöntemlerim'e GİTMEZ: aynı pencerede Kart Ekle adımı (Güvenlik kutusu yok, kart animasyonu en üstte).
  Eklenen kart listede seçili gelir; seçim sayfaya yalnızca "Seç" ile yazılır. Esc önce geri gider, listede kapatır;
  kapanınca odak "Değiştir"e döner. Seçili kart silinirse kalan en yeni geçerli kart seçilir (sayfada da). Pencere
  kartları Ödeme Yöntemlerim'le aynı sorgudan okur (`cardKeys.list`); ekleme ve silme onu günceller. Ekleme adımı
  kapanınca (geri, Esc, X, başarı) form kalkar: numara ve CVV bellekte kalmaz (M7). Kayıt sürerken ikinci gönderme
  bırakılır (`single-flight.ts`). Production'da (`__CARD_VAULT__` kapalı) pencere pakete girmez, düğmeler pasif.
- **Kişisel veri** (alıcı adı ve telefonu, notlar) yalnızca form durumunda yaşar (`useCheckoutForm`); depoya,
  önbelleğe ve adrese yazılmaz. Kartın yalnızca ilk 4 ve son 4 hanesi görünür; PAN ve CVV bu sayfada yok (M7).
- **Sözleşme metinleri demo** yer tutucu (`checkout.preInfoParagraphs`, `distanceSalesParagraphs`); gerçek metin
  içerikten değişir.
- **Sipariş akışı (T12.4):** "Sipariş Ver" ilk eksik koşul varken pasif ve altında o koşul yazar. İstekten hemen önce
  koşullar yeniden denetlenir. Akış: `POST /v1/cart/reserve` (niyet anahtarı; belirsiz sonuçta korunur, sonuç kesin
  bitince — başarı, ret, Vazgeç, süre, hak — yenilenir), `POST /v1/orders` (deneme anahtarı;
  **taslak gövde** `payment.cardId` + `details`, B1/B2 backend'e gelince `order-draft.ts` sözleşmeye taşınır),
  3DS gerekirse `POST /v1/orders/:id/3ds` (her kod yeni anahtar). Vazgeç, süre ya da hak bitince
  `DELETE /v1/cart/reserve/:id` (yeni anahtar; 404 sessiz; 409'da sipariş okunur, ödendiyse başarı).
- **Geri sayım** sunucunun `ttlSeconds`'ından ve kodun 60 sn'sinden (payment-service) kısa olanla, monotonik saatle;
  son 30 saniyede uyarı rengi ve ekran okuyucuya tek duyuru. **3DS kodu sırdır**: yalnız pencerenin alanında, her
  denemeden sonra silinir; günlüğe, depoya ve adrese girmez. Hatalar gateway'in cümlesiyle bildirim olur.

## Market ekranları (T5.4) — tasarımsız kabuk

Market sayfasının görsel tasarımı T16.2'de geldi (yukarıda). Bu bölüm T5.4'ün veri katmanı kararlarını tutar.

- **Konum:** seçili teslimat adresi (T9.5, `features/address`); oturumsuzken varsayılan "Ev".
- **Ana sayfa ve `/markets`:** market listesi (T11.12, yukarıda; ana sayfada liste başlığı h2, `/markets`'ta
  h1). Market sayfası ve listenin adres parametreleri (`?kategori=`, `?ara=`, `?tur=`)
  `features/markets/routes.ts`'te tek yerde.
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
(`http://localhost:5173/giris`, "Demo hesaplar"dan biri, "Giriş yap"). Karşılama ekranı
`GET /v1/content/welcome` ister: gateway T11.6'dan eskiyse ekran hata gösterir, gateway yeniden başlatılır
(içeriğe alan eklendiğinde de, ör. T11.8 `addressSetup`).

## Klasörler

```text
src/
  app/        router, QueryClient, sağlayıcılar
  pages/      rota başına sayfa kabuğu
  features/   özellik başına api + hook + ui (catalog, markets, cart, auth, search, address, content)
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

## Hesap menüsü (T11.16)

Kullanıcı isteği: profil sayfasının sol menüsü ve üst barın Profil açılır menüsü AYNI başlıkları aynı sırayla
gösterir: Profilim, Adreslerim, Favori İşletmeler, Geçmiş Siparişlerim, Ödeme Yöntemlerim (T11.17; yalnızca
geliştirme paketinde, aşağıda).

| Parça       | Dosya                                 | Not                                                                                                                 |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tek liste   | `pages/account/account-menu.ts`       | `accountMenuItems`: rota + içerikteki etiket anahtarı; madde eklemek = satır + etiket                               |
| Sol menü    | `pages/account/AccountMenu.tsx`       | Geçerli sayfa vurgulu; Profilim yalnızca `/hesabim`'de (`end`), sipariş detayı da Geçmiş Siparişlerim'i seçer       |
| Profil menü | `app/AppHeader.tsx` → `HeaderAccount` | Maddeler aynı listeden; altta ince çizgiyle ayrı satırda "Çıkış yap"; madde en az 44 px (`--size-header-menu-item`) |

- **Metinler içerikten** (`accountMenu` bloğu; `useAccountMenuContent`, içerik gelmezse yedek). Eski
  `favorites.profileMenuLabel/addressesLabel/favoritesMenuLabel` ve `appHeader.favoritesLabel` kalktı.
- **Test:** `account-menu.spec.ts` iki menünün aynı maddeleri aynı sırayla çizdiğini uygulamanın bağlantısıyla
  (`AppHeaderAccount`) doğrular.
- **Alt sayfalar** (sipariş detayı, kart ekle) `AccountLayout variant="nested"`: telefonda "‹ Hesabım" yok, sayfa kendi
  üst sayfasına döner; iki geri bağlantısı üst üste binmez.

## Ödeme Yöntemlerim (T11.17)

`/hesabim/odeme-yontemlerim` (kayıtlı kartlar) ve `/hesabim/odeme-yontemlerim/ekle` (Kart Ekle), korumalı. Düzen
kullanıcının referansı (getircarsi "Ödeme Yöntemlerim" ve "Kart Ekle"); kart animasyonu bizim ekstramız, tasarım
**B "Markanın rengi"**: numara yazıldıkça kart o markanın gradyanına geçer, sağ üstte kendi çizdiğimiz rozet (D3),
arkada soluk kısa işaret ("VISA", "MC"), ışık şeridi, imleçle eğim ve parlama, odaktaki alanın çerçevesi, CVV'de arka
yüze dönme. Hareket azaltma açıkken dönme yerine solma; eğim, ışık, parlamanın imleci izlemesi ve hane düşmesi yok.

- **Liste:** beyaz kutuda satırlar: marka logosu, kart adı (yoksa marka adı), maskeli numara ("4242 \*\*\*\* \*\*\*\*
  4242"), süresi geçtiyse etiket, çöp kutusu. Son satır "+ Kredi/Banka Kartı"; kasa doluysa onun yerine sözleşmenin
  cümlesi; kartı olmayan hesapta yalnızca bu satır.
- **Kart Ekle:** "< Ödeme Yöntemlerim'e geri dön", başlık; beyaz kutuda sırayla Güvenlik kutusu (kendi metnimiz), kart
  adı, numara, kart üzerindeki isim, "Kartın Son Kullanma Tarihi:" Ay/Yıl seçimleri ve CVV, zorunlu "Kullanım
  Koşulları'nı okudum, kabul ediyorum" (bağlantı içerikteki koşulları pencerede açar), tam genişlik "Devam", sağ altta
  kabul edilen kartlar. Kart geniş ekranda (`--bp-xl`) kutunun sağında yapışkan, dar ekranda Güvenlik kutusunun altında.

| Parça      | Dosya                                                                                | Not                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Kart       | `features/cards/ui/CardVisual.tsx`                                                   | Büyük (Kart Ekle); iç ölçüler kartın genişliğine oranlı (`cqi`), ölçü ve renkler `payment-card/tokens.css`  |
| Kart yüzü  | `features/cards/services/card-face.ts`                                               | Yalnızca ilk 4 ve son 4 hane, aradakiler "•"; liste numarası yıldızlı; kısa ad "Visa •••• 4242"             |
| Form       | `features/cards/ui/AddCardForm.tsx`, `hooks/useCardForm.ts`, `services/card-form.ts` | Parçalar: `SecurityNotice`, `CardNumberField`, `ExpirySelects`, `TermsField`, `FormAlert`, `AcceptedBrands` |
| Kurallar   | `@getir/contracts` `card-rules.ts`                                                   | Cümleler, marka uzunlukları (`BRAND_LENGTHS`), yıl seçenekleri (`cardExpiryYears`, İstanbul takvimi)        |
| Liste      | `pages/account/PaymentMethodsView.tsx`, `features/cards/ui/BrandLogo.tsx`            | Satırlar; çöp kutusunun adı karttan ("Visa •••• 4242 kartını sil")                                          |
| Veri       | `features/cards/api`, `hooks/useSavedCards`, `useAddCard`, `useDeleteCard`           | `GET`/`POST`/`DELETE /v1/me/cards`; anahtarlar kullanıcıya bağlı                                            |
| Pencereler | `features/cards/ui/DeleteCardDialog.tsx`, `TermsDialog.tsx`                          | Ortak kabuk `shared/ui/dialog/Dialog.tsx` (adres ve profil de kullanır), onay gövdesi `ConfirmPanel`        |

- **Numara ve CVV yalnızca form durumunda (M7):** kart görseline maskeli gider; sorgu ve mutasyon önbelleğine, tarayıcı
  deposuna, adrese ve Idempotency-Key'e girmez. Kaydetme bu yüzden `useMutation` değil (`saveCard`): mutasyon önbelleği
  isteği saklardı. Anahtar rastgele ve denemeye bağlı (`services/attempt-key.ts`): sonucu belirsiz deneme (ağ, 503;
  ilk istek sürüyor: 409 `REQUEST_IN_PROGRESS`) aynı anahtarla tekrarlanır, sunucu cevap verince yenisi; belirsiz
  denemeden sonra form değişirse yenisi. Formun niyet anahtarı (`createIntentKeys`) gövdenin JSON'unu tuttuğu için
  burada kullanılmaz. Testli (`card-save.spec.ts`).
- **Aynı kart:** kasa 409 + `cardId` dönerse formun üstünde "Bu kart zaten kayıtlı."; diğer 409'lar sözlüğün cümlesiyle.
- **Silme:** cevap güncel liste; kart başka cihazda zaten silinmişse (404) silme başarı sayılır, liste yeniden okunur.
- **Numara alanı:** gruplanmış metinde imleç yerinde kalır; boşluktan sonra Backspace önceki rakamı siler.
- **Production'da yok (K1 (a)):** kart uçları production'da kapalı; menü maddesi ve iki rota `__CARD_VAULT__` bayrağıyla
  yalnızca geliştirme paketinde. `scripts/check-web-bundle.mjs` production paketinde `/v1/me/cards` ve
  `odeme-yontemlerim` arar (`pnpm verify` ve CI). İçerik yedeğindeki metinler (veri) pakette kalır.
- **Çok fazla deneme (K2):** 429 + `retryAfterSeconds` gelince formun üstünde sözlüğün cümlesi (canlı bölge) ve onun
  dışında geri sayım ("Yeniden deneyebilmen için 4:59"; ekran okuyucu her saniye konuşmaz); süre bitene kadar Devam
  pasif.
- **Metinler içerikten** (`paymentMethods` bloğu; içerik gelmezse yedek, `payment-methods-fallback.ts`). Kural
  cümleleri içerikte değil, sözleşmede (`CARD_FIELD_MESSAGES`): kasa aynı cümleleri döner.

## Geçmiş Siparişlerim (T11.16)

`/hesabim/siparislerim` ve detay `/hesabim/siparislerim/:orderId` (korumalı), hesap sayfalarının ortak içerik
kabında; görsel dil Adreslerim'in.

| Parça | Dosya                                                                  | Not                                                                                                                                                |
| ----- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liste | `pages/account/OrdersPage.tsx`, `OrdersView.tsx`                       | Satır "Market · 500,00 TL · Tamamlandı", altında tarih, sağda ok; satırın tamamı detay bağlantısı                                                  |
| Detay | `pages/account/OrderDetailPage.tsx`, `OrderDetailView.tsx`             | Listeye dönüş, market adı ve durum, tarih ve adres, ürünler, tutar dökümü (ücretsiz teslimat, indirim)                                             |
| Veri  | `features/orders/api`, `hooks/useOrderHistory.ts`, `useOrderDetail.ts` | `GET /v1/orders` (imleç, "Daha fazla göster" = sonraki sayfa), `GET /v1/orders/{id}`; anahtarlar kullanıcıya bağlı; market adı detayda `useMarket` |
| Durum | `features/orders/services/order-status.ts`, `ui/OrderStatusLabel.tsx`  | 13 durum 3 gruba: Tamamlandı (yeşil), Devam ediyor (sarı rozet), İptal edildi (gri; ücret alınmışsa "· Ücret iade edildi")                         |

- **Kararlar (L1-L8, 5 Ekim):** sepet taslakları listede yok (gateway süzer); market adı gelmezse "Market";
  iptal edilen siparişte her ürün "Teslim edilmedi" (sipariş düzeyi, #91); iade = `CANCELLED` + geçmişte
  `PAID` (listede sunucunun `refunded`'ı, detayda `wasRefunded`, aynı kural). Sonraki sayfa hata verirse liste
  yerinde kalır, altında "Tekrar dene".
- **Metinler içerikten** (`orders` bloğu; içerik gelmezse yedek). Satır ve "Daha fazla göster" en az 44 px
  (`--size-order-row`). Tarih `formatDateTime` (tr-TR, tarayıcının saat dilimi).

## Adreslerim sekmesi (T11.15)

`/hesabim/adreslerim` (korumalı), hesap sayfalarının ortak içerik kabında; görsel dil profil kartının (T11.14 PR 2).

| Parça       | Dosya                                                    | Not                                                                                 |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Sayfa       | `pages/account/AddressesPage.tsx`                        | Birleştirir: liste, T11.8'in penceresi (ekleme ve düzenleme modu), silme onayı      |
| Liste       | `pages/account/AddressesView.tsx`                        | Durumsuz; satırlar radyo grubu (satıra tıklamak seçer), sağda onay ya da çöp, kalem |
| Düzenleme   | `features/address/ui/AddressSetupDialog.tsx` (`editing`) | Harita adresin noktasında; nokta değişmediyse satır korunur (`isSamePoint`, ~1 m)   |
| Silme onayı | `features/address/ui/DeleteAddressDialog.tsx`            | Küçük pencere: "<ad> adresini silmek istiyor musun?", Vazgeç / Sil                  |
| Veri        | `hooks/useUpdateAddress.ts`, `hooks/useDeleteAddress.ts` | `PUT`/`DELETE /v1/me/addresses/{addressId}`; cevap güncel defter, önbelleğe yazılır |

- **Kararlar (5 Ekim, hepsi (a)):** seçili adreste yeşil onay, diğerlerinde çöp kutusu; seçili adres düzenleme
  penceresindeki "Adresi sil"le silinir. Her satırda kalem. "Ev / İş / Diğer adres ekle" türü seçili açar, başlık
  türün adıyla dolu (varsa "Ev 2"). Silmeden önce onay. Son adres silinince ekleme penceresi açılır, X ile kapanır.
- **Seçili adres silinince** defterin ilk adresi geçerli olur (kod gerekmez: seçim defterde bulunamaz).
- **Metinler içerikten** (`addresses` bloğu; içerik gelmezse yedek). Satır eylemleri en az 44 px (`--size-address-action`).

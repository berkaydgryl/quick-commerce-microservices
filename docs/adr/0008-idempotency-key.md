# ADR-08: Tum mutasyon uclari Idempotency-Key ister

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Ayni niyetin sisteme birden fazla kez ulasmasi istisna degil, normaldir: musteri "Siparisi
tamamla" dugmesine iki kez basar, mobil aginda kopan istek istemci tarafindan yeniden
denenir, gateway zaman asiminda istegi tekrarlar ve olay hatti en az bir kez teslim eder
(ADR-04). Bu tekrarlarin her biri ikinci bir siparis, ikinci bir cekim ya da ikinci bir
rezervasyon yaratirsa sistem musterinin parasiyla ve depodaki gercek stokla oynamis olur.

## Karar

Siparis olusturma, odeme baslatma ve rezervasyon dahil butun mutasyon uclari zorunlu
Idempotency-Key basligi ister; anahtari istemci uretir ve niyet basina tektir. Uc, ise
baslamadan once anahtari Redis'e NX ile in-progress olarak yazar. Yazim basarisizsa iki
durum vardir: kayitli bir sonuc varsa ayni yanit aynen dondurulur, hala in-progress ise
istek "islem suruyor" olarak reddedilir. Is bittiginde durum kodu ve yanit ozeti ayni
anahtara TTL ile yazilir. Anahtar bulunmayan mutasyon istegi 400 ile reddedilir.

## Gerekce

Yalnizca sonucu onbelleklemek yetmez: iki kopya istek ayni anda geldiginde ikisi de
"kayit yok" gorup birlikte calisir, yani klasik cift tiklama tam olarak korunmasiz kalan
durumdur. Once in-progress isaretini koymak, yarisin kaybedenini daha is baslamadan
durdurur ve bunu tek atomik komutla yapar. Alternatif olarak dogal anahtar (musteri +
sepet ozeti) uzerinden tekillestirme dusunuldu ama elendi: mesru ikinci siparisi de
engeller ve ozetin nasil hesaplandigina bagli kirilgan bir kurala donusur.

## Sonuclari

- Olumlu: tekrarlanan istek zararsizdir; yeniden deneme, istemcide ve gateway'de guvenle
  acilabilir; tuketiciler icin de ayni desen olay id'si uzerinden kullanilir.
- Olumsuz: istemci anahtar uretmek zorundadir ve bu sozlesmede acikca belgelenir.
  Saklanan yanit boyutu sinirlidir, buyuk govdeler ozetlenerek tutulur.
- Kabul edilen borc: process arada cokerse in-progress isareti TTL dolana kadar kalir ve
  o niyet gecici olarak bloke olur; TTL degeri sabit olarak yapilandirilir.

## Ilgili

ADR-01, ADR-04, ADR-09; gorev T1.5.

## Ek (T8.2, 2026-09-29): kaydin bicimi, kapsami ve omru

Roadmap P5 ve B6'nin bagladigi ayrintilar. Ustteki karar degismez; bu ek onu netlestirir ve
iki noktada (saklanan cevap, kayit ucu) ustteki metinden ayrilir; ayrilmanin gerekcesi
yanindadir. Uygulayan gateway'dir (`apps/gateway/internal/httpapi/idempotency.go`, depo
`internal/idempotency`); korunan uclar POST /v1/auth/register, /v1/cart/reserve, /v1/orders
ve /v1/orders/{id}/3ds.

- Anahtar bicimi: 8-128 karakter; yalnizca harf, rakam, `-` ve `_` (@getir/core
  `IDEMPOTENCY_KEY_*`; UUID v4 bu kumededir). `:` ve `{}` Redis anahtarinin ayiricisidir,
  istemciden gelemez. Bicimsiz anahtar 400 VALIDATION_FAILED; anahtarsiz mutasyon yine 400.
- Kapsam: kayit `idem:{usr_...}:<anahtar>` anahtarinda durur, anahtar kullanici basinadir.
  Iki kullanici ayni anahtari secse kayitlari ayrisir; biri digerinin cevabini (kisisel
  veri) tekrar olarak alamaz. Kimliksiz uc (kayit) ortak `anon` kapsamindadir. Bicim
  @getir/redis-kit `idempotencyKey(scope, key)`'dedir; gateway'in testi o satiri okuyup
  karsilastirir.
- In-progress: `SET NX PX 30000` (B6); kayitta sahibin rastgele jetonu ve istegin parmak izi
  durur. Bitirme ve birakma yalnizca kayit hala ayni jetonla in-progress ise yazar (Lua):
  suresi dolup baska istegin aldigi kaydin ustune eski istek yazamaz. Kayit is surerken
  dusmemeli: korunan ucun butun isi 25 saniyelik bir son tarihle calisir
  (`GATEWAY_REQUEST_TIMEOUT_MS` ne olursa olsun). Redis komutlari surucu tarafindan yeniden
  denenmez; cevabi kaybolan bir SET NX'i ayni jetonla goren istek kaydi kendisinin sayar.
- Parmak izi: yontem, yol ve govdenin HMAC-SHA256'si; anahtari JWT sirrindan ayri etiketle
  turetilir. Duz ozet degil HMAC: kayit govdesinde sifre var, Redis sizarsa duz ozet kaba
  kuvvetle cozulebilirdi. Ayni anahtar + farkli istek 409 CONFLICT'tir (anahtarin yanlis
  yeniden kullanimi, P5).
- Cevaplar: ayni istek hala isleniyorsa 409 REQUEST_IN_PROGRESS; bitmisse ilk cevap (durum
  kodu + govde) aynen doner ve `Idempotent-Replayed: true` basligini tasir. Tekrar edilen
  hata zarfinda requestId bu istegin kimligidir (govdedeki requestId basliktakiyle ayni
  olmali).
- Saklanan cevap (ustteki metinden ayrilir): "yanit ozeti" (P5: "kompakt kayit") yerine
  cevap govdesinin kendisi, en fazla 16 KB. Gerekce: bugunku cevaplar birkac yuz bayttir,
  P5'in bellek kaygisi boyle de karsilanir; ozetten cevabi yeniden kurmak ikinci bir okuma
  yolu ve ilk cevaptan ayrisabilen ikinci bir cevap demekti. 16 KB'yi asan govde saklanmaz;
  tekrarinda uc yeniden calismaz, 409 CONFLICT doner ve gunluge uyari yazilir (bugun hicbir
  ucta olmaz).
- Saklanmayanlar: 5xx, 400 (dogrulama; ucun yan etkisi yok), 401 (oturum; yeniden girisle
  duzelir) ve 429 (hiz siniri). Bunlarda anahtar birakilir, istemci ayni anahtarla yeniden
  dener. Diger 4xx (is kurali: stok yetersiz, siparis bulunamadi) saklanir ve tekrar edilir.
- Omur: basarili siparis ve 3DS kaydi (2xx) 2 saat (P5); diger her bitmis kayit
  `IDEMPOTENCY_TTL_SECONDS` (varsayilan 24 saat); in-progress 30 saniye. TTL'siz kayit yoktur.
- Kayit ucu (ustteki metinden ayrilir): kayit cevabi erisim ve yenileme jetonu tasir; jeton
  Redis'e yazilmaz. Kayit ucunda yalnizca in-progress ve parmak izi korumasi vardir; bitmis
  bir kaydin tekrari uca gecer ve telefon benzersizligi 409 PHONE_ALREADY_REGISTERED
  dondurur, ikinci hesap acilmaz. "Ayni yanit aynen dondurulur" kuralinin tek istisnasidir.
- Redis ulasilamazsa korunan uclar 503 SERVICE_UNAVAILABLE doner (fail-closed): korumasiz
  siparis almak cift siparis riskidir. Gateway Redis'siz acilmaz; /healthz Redis'i raporlar.
  (Hiz siniri, T8.2'nin ikinci PR'i, bunun tersine fail-open'dir.)
- MOCK=true: kayitlar gateway'in belleginde, ayni kurallarla tutulur; Redis'e gidilmez. Tek
  ornekte ayni davranir, ornekler arasinda paylasilmaz.
- Kabul edilen borc (ustteki) somutlasti: coken istegin in-progress kaydi en fazla 30 saniye
  kalir; o arada istemci 409 REQUEST_IN_PROGRESS alir, sonra ayni anahtarla yeniden dener.

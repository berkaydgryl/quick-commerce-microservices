# ADR-12: Kimlik dogrulama telefon + sifre ile yapilir, SMS/OTP kurulmaz

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Hizli market uygulamalarinda kimlik genellikle telefon numarasi ve SMS ile gonderilen tek
kullanimlik koddur. Bu akis gercek bir SMS saglayicisi, ucret, numara dogrulama kuyrugu,
kod yeniden gonderme sayaci ve saglayici kesintisinde yedek yol gerektirir. Demoda bunun
karsiligi, tamami dis bir servise bagli ve gosterilemeyen bir is paketidir. Ote yandan
kimligin kendisi sistemin her yerinde gerekli: gateway, servisler ve realtime ayni
oturumu tanimak zorunda (ADR-06).

## Karar

Kimlik dogrulama telefon numarasi + sifre ile yapilir. Sifreler bcrypt ile saklanir; ham
sifre hicbir yerde loglanmaz. Basarili girisde kisa omurlu erisim token'i (JWT,
JWT_TTL=3600) ve uzun omurlu refresh token verilir; erisim token'i hem HTTP hem
WebSocket el sikismasinda ayni sekilde dogrulanir. SMS/OTP altyapisi bugun kurulmaz.
Risk motorunun otp-velocity kurali (kisa surede cok sayida kod talebi) tasarimda yerini
korur ama uygulamasi ileriye birakilir; risk motoru bugun diger sinyallerle calisir.

## Gerekce

Telefon + sifre, dis bagimliligi sifira indirir ve demo her yerde, cevrimdisi bile
calisir. Telefon numarasini kullanici anahtari olarak tutmak, ilerde OTP eklendiginde
sema degisikligi gerektirmez: eklenecek olan yalnizca ikinci bir dogrulama yontemidir.
Sahte OTP (ekranda gosterilen sabit kod) alternatifi elendi cunku hem guvenlik izlenimi
verir hem de gercek olmayan bir akis icin kod yazdirir.

## Sonuclari

- Olumlu: kimlik akisi uctan uca kendi kodumuzda, testi kolay ve deterministik; token
  dogrulama tek yerde tanimlanip her serviste yeniden kullanilir.
- Olumsuz: numaranin gercekten kullaniciya ait oldugu dogrulanmaz; bu, urun degil demo
  kararidir ve belgede acikca soylenir.
- Kabul edilen borc: refresh token dondurme ve iptal listesi sade tutulur; otp-velocity
  kurali kagit uzerinde kalir.

## Ilgili

ADR-06, ADR-08, ADR-09; gorev T1.5.

## Ek (T8.5 hazirligi, 2026-09-29): yenileme jetonu HttpOnly cerezde

Ustteki karar degismez; jetonun istemciye nasil tasindigini netlestirir. Web kimlik akisi (T8.5)
jetonlari tarayicida saklayacagi icin karar oncesinde verildi.

- Erisim jetonu (JWT, JWT_TTL) cevap govdesinde doner; istemci onu yalnizca bellekte tutar
  (localStorage'a yazilmaz).
- Yenileme jetonu govdede DONMEZ: gateway onu `getir_refresh` cerezine yazar. HttpOnly: sayfadaki
  betik okuyamaz, bir XSS 14 gunluk jetonu calamaz. `SameSite=Strict`: baska bir siteden gelen
  istek cerezi tasimaz (CSRF). `Path=/v1/auth`: jeton yalnizca kimlik uclarina gider. Omur
  REFRESH_TTL; production'da `Secure`.
- `POST /v1/auth/refresh` ve `/v1/auth/logout` govdesizdir; jeton cerezden okunur. Cerezsiz
  yenileme 401'dir; kullanilamayan jetonun cerezi ve cikista cerez silinir.
- Elenen: yenileme jetonunu localStorage'da tutmak (gateway degismezdi ama XSS'te jeton
  calinirdi) ve sessionStorage (sekme kapaninca oturum giderdi).
- Bedel: tarayici disi istemciler (curl, testler) cerez kavanozu kullanir; web ile gateway ayni
  site (gelistirmede Vite vekili) uzerinden calismalidir. Sozlesme degisti: oturum govdesinde
  `refreshToken` yok (`@getir/contracts` authSessionSchema, openapi AuthSession).
- Web istemcisi (T8.5 ikinci PR): erisim jetonu yalnizca sekmenin belleginde durur; sayfa
  yenilenince acilista bir kez sessiz yenileme oturumu geri getirir, herkese acik sayfa onu
  beklemez. 401 alan istek bir kez yenilenip bir kez tekrarlanir (`apps/web/src/shared/session`).
- Sekmeler arasi sira: jeton her kullanimda degistigi ve kullanilmis jetonun 401'i cerezi sildigi
  icin iki sekmenin ayni anda yenilemesi ikisinin de oturumunu dusururdu. Yenileme, giris, kayit
  ve cikis butun sekmelerde tek kilitle (Web Locks API, `getir-oturum`) sirayla calisir; ikinci
  sekme birincinin yazdigi YENI cerezi gonderir. Web Locks yoksa (guvensiz baglam) kilit sekme
  icindedir.
- Yenileme ve cikis genel hiz sinirindadir (IP basina dakikada 120, T8.2): web her acilista
  yeniler; jeton 256 bit rastgele oldugu icin kaba kuvvet siniri gerekmez. Kayit ve giris 10'da
  kalir.

## Ek (T11.14, 2026-10-04): e-posta dogrulanmis iletisim alanidir, kimlik degil

Ustteki karar degismez: giris telefon + sifredir, kayit formu e-posta almaz. Profil kartina
e-posta eklenir (kullanicinin karari, getircarsi referansi); bu ek onun sinirlarini yazar.

- **Kimlik degil.** E-postayla giris yapilmaz, sifre yenilenmez; yalnizca iletisim ve ileride
  makbuz icindir. Hesaba yalnizca DOGRULANMIS adres yazilir (`users.email`, kucuk harfli;
  `emailVerifiedAt`). Dogrulanmamis adres hesaba hic girmez: bekleyen kodun yaninda Redis'te durur.
- **Dogrulama kodla.** `POST /v1/me/email/code` adrese 6 haneli kod gonderir;
  `POST /v1/me/email/verify` kodu dogrular ve adresi yazar. Kod 10 dakika gecerlidir, 5 yanlista
  iptal olur, yeni kod en erken 60 saniye sonra istenir (kullanicinin karari A2). Yeni kod
  oncekini gecersiz kilar. Kurallar `@getir/contracts` sabitlerindedir; gateway ayni degerleri
  uygular.
- **Kod Redis'te, ozetiyle.** Anahtar `verify:email:{usr_...}` (redis-kit `emailVerificationKey`),
  tek hash: adres, kodun HMAC ozeti (anahtar JWT sirrindan turetilir; 10^6 ihtimalli kodun duz
  ozeti tersine cevrilirdi), deneme sayisi, gonderim ani. TTL koddur (10 dk). Bekleme, sayim ve
  iptal tek Lua betiginde: es zamanli denemeler hakki asamaz, iki gonderimden biri yazar.
- **Bir adres bir hesap** (A3). `users.email` uzerinde KISMI benzersiz indeks (yalnizca e-postasi
  olan belgeler); kod istenirken baska hesaptaki adres reddedilir, dogrulama aninda yaris indeksle
  cozulur. Bilincli odunlesim: cevap adresin baska hesapta oldugunu soyler (T11.7'deki numara
  kontrolu gibi); iki uc kullanici basina kimlik siniri (dakikada 10) ve 60 saniye beklemeyle
  yavaslatilir.
- **Hata kodu eklenmez.** Kural ihlali alanin altinda gosterilen `VALIDATION_FAILED`'dir (`email`
  ya da `code`; adres defterindeki "ayni ad" kalibi), erken yeniden gonderme `RATE_LIMITED` +
  `retryAfterSeconds`, posta sunucusu yoksa `SERVICE_UNAVAILABLE` (kod silinir, beklemeden
  yeniden istenir).
- **Posta.** Gateway standart kutuphanenin SMTP istemcisiyle gonderir (yeni bagimlilik yok).
  Gelistirmede sunucu compose'daki Mailpit'tir (ileti disari cikmaz, `localhost:8025`). Kod
  gunluge yazilmaz; SMTP hatasinin metni (aliciyi yansitabilir) atilir, yalnizca kod kalir.
  MOCK'ta `SMTP_URL` yoksa ileti bellekte kalir. Production SMTP'si (TLS, kimlik dogrulama)
  bekleyen is #90; production'da `SMTP_URL` zorunludur.
- Elenen: e-postayi kayitta toplamak (dogrulanmadan kimlik alanina donusurdu), kodu Mongo'da
  tutmak (TTL indeksi dakikalik calisir, 10 dakikalik kodda sure kayardi; deneme sayimi icin
  ikinci atomik yazim gerekirdi) ve ayri hata kodlari (`EMAIL_ALREADY_REGISTERED` vb.: web formu
  zaten alan cumlesini gosteriyor; `@getir/core` servislerle ortaktir).
